import { Router } from 'express';
import { and, desc, eq, gt, gte, ilike, lt, lte, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { legislativeBills as bills, legislativeSourceSync as sources } from '../../db/schema';
import { validatePage, validateUuid } from '../groups/groups.validator';
import { identityErrorHandler } from '../identity/session.middleware';
import { invalidField } from '../identity/validators/registration.validator';
import { meetingsNoStore } from '../meetings/meetings.routes';
import { legislativeSources } from './legislative-sources';
import { freshnessMs, ufs, type LegislativeBill } from './legislative.types';

const regionalSites = {
  AC:'https://www.al.ac.leg.br/',AL:'https://www.al.al.leg.br/',AP:'https://www.al.ap.leg.br/',AM:'https://www.al.am.leg.br/',
  BA:'https://www.al.ba.gov.br/',CE:'https://www.al.ce.gov.br/',DF:'https://dados.cl.df.gov.br/dataset/proposicoes',
  ES:'https://www.al.es.gov.br/',GO:'https://portal.al.go.leg.br/',MA:'https://www.al.ma.leg.br/',MT:'https://www.al.mt.gov.br/',
  MS:'https://al.ms.gov.br/',MG:'https://dadosabertos.almg.gov.br/',PA:'https://alepa.pa.gov.br/',PB:'https://www.al.pb.leg.br/',
  PR:'https://transparencia.assembleia.pr.leg.br/servicos/dados-abertos',PE:'https://www.alepe.pe.gov.br/',
  PI:'https://www.al.pi.leg.br/',RJ:'https://www.alerj.rj.gov.br/',RN:'https://www.al.rn.leg.br/',
  RS:'https://www.assembleia.rs.gov.br/',RO:'https://www.al.ro.leg.br/',RR:'https://al.rr.leg.br/',
  SC:'https://portalelegis.alesc.sc.gov.br/proposicoes/processo-legislativo',SP:'https://www.al.sp.gov.br/alesp/pesquisa-proposicoes/',
  SE:'https://al.se.leg.br/',TO:'https://www.al.to.leg.br/',
} satisfies Record<typeof ufs[number], string>;

function dto(row: LegislativeBill) {
  return { ...row, source_updated_at: row.source_updated_at?.toISOString() ?? null, verified_at: row.verified_at.toISOString() };
}

function offer(now: Date) {
  return and(eq(bills.status, 'in_progress'), gte(bills.verified_at, new Date(now.getTime() - freshnessMs)),
    lte(bills.verified_at, now));
}

export function createLegislativeRouter(db: NodePgDatabase, clock = () => new Date()) {
  const router = Router();
  const path = '/legislative-bills';
  const supported = new Set(legislativeSources.map(source => source.key));
  router.get(path + '/suggestions', meetingsNoStore, async (req, res) => {
    const { uf, ...extra } = req.query;
    if (Object.keys(extra).length || (uf !== undefined && (typeof uf !== 'string' || !Object.hasOwn(regionalSites, uf)))) {
      invalidField('uf', 'Informe uma UF brasileira válida.');
    }
    const selection = uf as keyof typeof regionalSites | undefined;
    const now = clock();
    const response = await db.transaction(async tx => {
      async function section(key: string | null, officialUrl: string | null) {
        const empty = { items: [], last_success_at: null, official_url: officialUrl };
        if (!key) return { ...empty, status: 'needs_uf' };
        if (!supported.has(key)) return { ...empty, status: 'unsupported' };
        const [source] = await tx.select().from(sources).where(eq(sources.house_key, key));
        const rows = await tx.select().from(bills).where(and(eq(bills.house_key, key), offer(now)))
          .orderBy(desc(bills.verified_at), desc(bills.id)).limit(3);
        const last = source?.last_success_at ?? null;
        const expired = rows.length ? [] : await tx.select({ id: bills.id }).from(bills).where(and(
          eq(bills.house_key, key), eq(bills.status, 'in_progress'), lt(bills.verified_at, new Date(now.getTime() - freshnessMs)),
        )).limit(1);
        const status = rows.length ? (source?.failure_code ? 'degraded' : 'fresh') :
          (expired.length || (last && now.getTime() - last.getTime() > freshnessMs)) ? 'stale' :
          source?.failure_code || !last ? 'degraded' : 'empty';
        return { items: rows.map(dto), status, last_success_at: last?.toISOString() ?? null, official_url: officialUrl };
      }
      return {
        senate: await section('SF', 'https://legis.senado.leg.br/'),
        chamber: await section('CD', 'https://dadosabertos.camara.leg.br/'),
        regional: await section(!selection ? null : selection === 'DF' ? 'CLDF' : 'AL-' + selection,
          selection ? regionalSites[selection] : null),
      };
    }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
    res.json({ data: response });
  });
  router.get(path, meetingsNoStore, async (req, res) => {
    const { house_key: house, q, ...pageQuery } = req.query;
    if (house !== undefined && (typeof house !== 'string' ||
        (!['SF', 'CD', 'CLDF'].includes(house) && !(house.startsWith('AL-') && Object.hasOwn(regionalSites, house.slice(3)) && house !== 'AL-DF')))) {
      invalidField('house_key', 'Informe a casa legislativa.');
    }
    if (q !== undefined && (typeof q !== 'string' || q.length > 120 || q.includes('\u0000'))) invalidField('q', 'Informe um termo de até 120 caracteres.');
    const page = validatePage(pageQuery, validateUuid);
    const term = typeof q === 'string' && q.trim() ? '%' + q.trim().replace(/[\\%_]/g, '\\$&') + '%' : null;
    const rows = await db.select().from(bills).where(and(offer(clock()),
      typeof house === 'string' ? eq(bills.house_key, house) : undefined,
      term ? or(ilike(bills.label, term), ilike(bills.abstract, term)) : undefined,
      page.after ? gt(bills.id, page.after) : undefined)).orderBy(bills.id).limit(page.limit + 1);
    res.json({ data: { items: rows.slice(0, page.limit).map(dto),
      next_cursor: rows.length > page.limit ? rows[page.limit - 1].id : null } });
  });
  router.get(path + '/:id', meetingsNoStore, async (req, res) => {
    const [row] = await db.select().from(bills).where(eq(bills.id, validateUuid(req.params.id, 'id')));
    if (!row) {
      res.status(404).json({ error: { code: 'LEGISLATIVE_BILL_NOT_FOUND', message: 'Projeto de lei indisponível.', details: {} } });
      return;
    }
    res.json({ data: dto(row) });
  });
  router.use(identityErrorHandler);
  return router;
}
