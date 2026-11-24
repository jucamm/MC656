import 'dotenv/config';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  legislativeBills, legislativeCompendiumSummaries, meetingMinuteEvents, meetingMinuteRevisions,
  meetingMinutes, meetingParticipants, meetings, users,
} from '../db/schema';
import { pipelineRevision } from '../modules/legislative-compendia/compendium-synthesis';
import { eligibleManifests } from '../modules/legislative-compendia/eligible-minutes';

const examples = [
  {
    number: 9001, house: 'SF', uf: null, title: 'Transporte público acessível',
    subject: 'Acessibilidade no transporte coletivo.',
    support: 'Rotas acessíveis facilitariam o deslocamento a escolas e unidades de saúde.',
    concern: 'A implantação precisa prever os custos de adaptação da frota.',
  },
  {
    number: 9002, house: 'CD', uf: null, title: 'Bibliotecas comunitárias',
    subject: 'Acesso à leitura e às atividades culturais em bibliotecas de bairro.',
    support: 'Bibliotecas de bairro poderiam ampliar o acesso gratuito a livros.',
    concern: 'A equipe pediu uma estimativa de custos de manutenção a longo prazo.',
  },
  {
    number: 9003, house: 'CD', uf: null, title: 'Hortas urbanas em escolas',
    subject: 'Educação ambiental e cultivo de alimentos em escolas públicas.',
    support: 'As hortas poderiam apoiar aulas práticas sobre alimentação e meio ambiente.',
    concern: 'Foi apontada a necessidade de manutenção durante as férias escolares.',
  },
  {
    number: 9004, house: 'CLDF', uf: 'DF', title: 'Energia solar em escolas do DF',
    subject: 'Uso de energia solar em escolas públicas do Distrito Federal.',
    support: 'A energia solar poderia reduzir despesas das escolas com eletricidade.',
    concern: 'A discussão pediu critérios para selecionar as primeiras escolas atendidas.',
  },
] as const;

function demoId(number: number, entity: number) {
  return 'de000000-0000-4000-800' + entity + '-' + String(number).padStart(12, '0');
}

function isLocalDatabase(value: string): boolean {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) return false;
  // pg também aceita parâmetros de conexão na query. Só permita o socket local
  // ou o endereço local na URL, sem opções que redirecionem a conexão.
  if ([...url.searchParams.keys()].some(key => !['host', 'port'].includes(key) || url.searchParams.getAll(key).length !== 1)) {
    return false;
  }
  return url.searchParams.has('host')
    ? !url.hostname && (url.searchParams.get('host') ?? '').startsWith('/')
    : ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

async function main() {
  const operatorEmail = process.argv[2]?.trim().toLowerCase();
  const connectionString = process.env.DATABASE_URL;
  if (!operatorEmail || !connectionString) {
    throw new Error('Configure DATABASE_URL e informe o e-mail de uma conta local verificada.');
  }
  if (process.env.NODE_ENV === 'production' || !isLocalDatabase(connectionString)) {
    throw new Error('Use um PostgreSQL local de desenvolvimento para os dados de demonstração.');
  }
  const pool = new Pool({ connectionString });
  try {
    const db = drizzle({ client: pool });
    await db.transaction(async tx => {
      const [operator] = await tx.select({ id: users.id }).from(users)
        .where(and(eq(users.email, operatorEmail), eq(users.status, 'verified')));
      if (!operator) throw new Error('Conta verificada não encontrada no banco local.');

      const now = new Date();
      const startsAt = new Date(+now - 7_200_000);
      const endedAt = new Date(+now - 3_600_000);
      const version = pipelineRevision + ':' + (process.env.GEMINI_MODEL?.trim() ?? 'unconfigured');
      for (const example of examples) {
        const { number, house, uf, title, subject, support, concern } = example;
        const billId = demoId(number, 1);
        const meetingId = demoId(number, 2);
        const revisionId = demoId(number, 3);
        const label = `PL ${number}/${now.getFullYear()} — ${title} [DEMO]`;
        await tx.insert(legislativeBills).values({
          id: billId, house_key: house, uf, external_id: 'unidebates-demo-' + number,
          kind: 'PL', number, year: now.getFullYear(), label, abstract: 'Proposta fictícia para demonstração. ' + subject,
          official_url: 'https://example.com/', status: 'in_progress',
          status_label: 'Em tramitação (fictício)', verified_at: now,
        }).onConflictDoUpdate({
          target: [legislativeBills.house_key, legislativeBills.external_id],
          set: { verified_at: now, year: now.getFullYear(), label },
        });

        const [created] = await tx.insert(meetings).values({
          id: meetingId, legislative_bill_id: billId, subject: 'Debate de demonstração: ' + title,
          created_by_user_id: operator.id, organizer_user_id: operator.id, ended_by_user_id: operator.id,
          access_mode: 'public', created_at: new Date(+startsAt - 3_600_000), starts_at: startsAt, ended_at: endedAt,
        }).onConflictDoNothing({ target: meetings.id }).returning({ id: meetings.id });

        if (created) {
          await tx.insert(meetingParticipants).values({
            meeting_id: meetingId, user_id: operator.id, origin: 'creator', status: 'confirmed',
          });
          await tx.insert(meetingMinutes).values({ meeting_id: meetingId, source_kind: 'notes', generation_status: 'ready' });
          await tx.insert(meetingMinuteRevisions).values({
            id: revisionId, meeting_id: meetingId, title: 'Ata fictícia — ' + title,
            body: ['Registro de demonstração. Nenhuma reunião real foi transcrita.', support, concern].join('\n\n'),
            source_kind: 'notes', created_by_user_id: operator.id, created_at: endedAt,
          });
          await tx.update(meetingMinutes).set({
            visibility: 'published', published_revision_id: revisionId, published_at: endedAt, version: 2,
          }).where(eq(meetingMinutes.meeting_id, meetingId));
          await tx.insert(meetingMinuteEvents).values({
            id: demoId(number, 4), meeting_id: meetingId, actor_user_id: operator.id,
            action: 'publish', revision_id: revisionId, from_visibility: 'unpublished', to_visibility: 'published',
            created_at: endedAt, resulting_version: 2,
          });
        }

        const hash = createHash('sha256').update(meetingId + ':' + revisionId).digest('hex');
        const manifests = eligibleManifests(tx);
        const [manifest] = await tx.select().from(manifests).where(eq(manifests.bill_id, billId));
        if (manifest?.source_hash !== hash) continue;
        const summary = {
          state: 'ready' as const, source_hash: hash, pipeline_version: version, generated_at: now,
          next_attempt_at: now, attempts: 0, failure_code: null, lease_token: null, lease_until: null,
          payload: [
            { stance: 'for' as const, argument: '[DEMO] ' + support, references: [{ meeting_id: meetingId, revision_id: revisionId, quote: support }] },
            { stance: 'unclassified' as const, argument: '[DEMO] ' + concern, references: [{ meeting_id: meetingId, revision_id: revisionId, quote: concern }] },
          ],
        };
        await tx.insert(legislativeCompendiumSummaries).values({ bill_id: billId, ...summary }).onConflictDoUpdate({
          target: legislativeCompendiumSummaries.bill_id, set: summary,
          setWhere: eq(legislativeCompendiumSummaries.source_hash, hash),
        });
      }
    });
  } finally {
    await pool.end();
  }
  console.log('Quatro PLs fictícios carregados. Abra Projetos de lei e busque por transporte, bibliotecas, hortas ou energia solar.');
}

void main().catch(error => {
  const known = ['Configure DATABASE_URL e informe o e-mail de uma conta local verificada.',
    'Use um PostgreSQL local de desenvolvimento para os dados de demonstração.',
    'Conta verificada não encontrada no banco local.'];
  console.error(error instanceof Error && known.includes(error.message) ? error.message :
    'Não foi possível carregar os PLs fictícios. Confira DATABASE_URL e execute npm run db:migrate.');
  process.exitCode = 1;
});
