import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../../app';
import {
  DecisionType,
  InconclusiveBehavior,
  InvalidityBehavior,
  QuorumFailureBehavior,
  TieResult,
  VotingMode,
} from '../decision-process.types';
import { InMemoryDecisionProcessRepository } from '../repositories/in-memory-decision-process.repository';

function validConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    decisionType: DecisionType.SIMPLE_MAJORITY,
    qualifiedMajorityPercentage: null,
    votingMode: VotingMode.OPEN,
    quorumPercentage: 50,
    quorumFailureRule: { behavior: QuorumFailureBehavior.CONTINUE },
    tieRule: { result: TieResult.REJECTED },
    inconclusiveRule: { behavior: InconclusiveBehavior.FINISH },
    invalidityRule: { behavior: InvalidityBehavior.FINISH },
    maxRestarts: 0,
    requiredParticipantIds: ['member-group-1'],
    ...overrides,
  };
}

describe('decision process routes', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp(new InMemoryDecisionProcessRepository());
  });

  function createProcess(userId = 'admin-group-1') {
    return request(app)
      .post('/groups/group-1/decision-processes')
      .set('X-Mock-User-Id', userId)
      .send({
        name: 'Maioria ordinária',
        configuration: validConfiguration(),
      });
  }

  const endpoints = [
    { method: 'post', suffix: '', write: true },
    { method: 'post', suffix: '/:id/versions', write: true },
    { method: 'put', suffix: '/:id', write: true },
    { method: 'get', suffix: '/:id', write: false },
    { method: 'get', suffix: '/:id/versions', write: false },
  ] as const;

  it.each(endpoints)('$method $suffix exige autenticação e respeita o papel no grupo',
    async ({ method, suffix, write }) => {
      const created = await createProcess();
      expect(created.status).toBe(201);
      const path = `/groups/group-1/decision-processes${suffix.replace(':id', created.body.process.id)}`;
      for (const userId of [undefined, 'missing', 'admin-group-2', 'member-group-1']) {
        const call = request(app)[method](path);
        if (userId) call.set('X-Mock-User-Id', userId);
        if (write) call.send({ name: 'Decisão', configuration: validConfiguration() });
        const response = await call;
        const expected = !userId || userId === 'missing' ? 401
          : userId === 'admin-group-2' || write ? 403 : 200;
        expect(response.status).toBe(expected);
        if (expected !== 200) {
          expect(response.body).toEqual({
            error: expected === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN',
            message: expect.any(String),
          });
        }
      }
      const history = await request(app).get(`/groups/group-1/decision-processes/${created.body.process.id}/versions`)
        .set('X-Mock-User-Id', 'admin-group-1');
      expect(history.body.versions).toEqual([created.body.activeVersion]);
    },
  );

  it.each(endpoints.filter((endpoint) => endpoint.write))(
    '$method $suffix ignora tentativas de falsificar identidade no corpo e no header de papel',
    async ({ method, suffix }) => {
      const created = await createProcess();
      const response = await request(app)[method](
        `/groups/group-1/decision-processes${suffix.replace(':id', created.body.process.id)}`,
      ).set('X-Mock-User-Id', 'member-group-1').set('X-Mock-User-Role', 'ADMIN')
        .send({
          requestedByUserId: 'admin-group-1', user: { id: 'admin-group-1' },
          groupId: 'group-2', name: 'Decisão', configuration: validConfiguration(),
        });
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('FORBIDDEN');
    },
  );

  it.each([
    { method: 'post', suffix: '/versions' },
    { method: 'put', suffix: '' },
  ] as const)('$method rejeita ausência de body ou configuração incompleta com 422',
    async ({ method, suffix }) => {
      const created = await createProcess();
      const path = `/groups/group-1/decision-processes/${created.body.process.id}`;
      for (const body of [undefined, {}, { configuration: {} }, { configuration: null }]) {
        const call = request(app)[method](path + suffix).set('X-Mock-User-Id', 'admin-group-1');
        if (body !== undefined) call.send(body);
        const response = await call;
        expect(response.status).toBe(422);
        expect(response.body).toMatchObject({ error: 'VALIDATION_ERROR', details: expect.any(Array) });
      }
      const current = await request(app).get(path).set('X-Mock-User-Id', 'admin-group-1');
      expect(current.body).toEqual(created.body);
    },
  );

  it('enum malformado retorna error code 422', async () => {
    const response = await request(app).post('/groups/group-1/decision-processes')
      .set('X-Mock-User-Id', 'admin-group-1').send({
        name: 'Decisão', configuration: validConfiguration({ decisionType: { toString: null } }),
      });
    expect(response.status).toBe(422);
    expect(response.body.details).toContainEqual(expect.objectContaining({
      path: 'configuration.decisionType', code: 'INVALID_VALUE',
    }));
  });

  it('usa grupo e usuário autenticado em vez dos identificadores enviados no corpo', async () => {
    const response = await request(app).post('/groups/group-1/decision-processes')
      .set('X-Mock-User-Id', 'admin-group-1').send({
        groupId: 'group-2', requestedByUserId: 'admin-group-2',
        name: 'Decisão', configuration: validConfiguration(),
      });
    expect(response.status).toBe(201);
    expect(response.body.process.groupId).toBe('group-1');
    expect(response.body.activeVersion.createdByUserId).toBe('admin-group-1');
  });

  it('POST de versão e PUT concorrentes preservam histórico e versão ativa', async () => {
    const created = await createProcess();
    const path = `/groups/group-1/decision-processes/${created.body.process.id}`;
    const responses = await Promise.all([
      request(app).post(path + '/versions').set('X-Mock-User-Id', 'admin-group-1')
        .send({ configuration: validConfiguration({ quorumPercentage: 60 }) }),
      request(app).put(path).set('X-Mock-User-Id', 'admin-group-1')
        .send({ configuration: validConfiguration({ quorumPercentage: 70 }) }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 200]);
    expect(responses.map((response) => response.body.activeVersion.versionNumber).sort()).toEqual([2, 3]);
    const history = await request(app).get(path + '/versions').set('X-Mock-User-Id', 'member-group-1');
    const current = await request(app).get(path).set('X-Mock-User-Id', 'member-group-1');
    expect(history.status).toBe(200);
    expect(current.status).toBe(200);
    expect(history.body.versions).toHaveLength(3);
    expect(history.body.versions[0]).toEqual(created.body.activeVersion);
    expect(current.body.activeVersion).toEqual(history.body.versions[2]);
    expect(current.body.process.activeVersionId).toBe(history.body.versions[2].id);
  });

  it('retorna 401 quando o header de autenticação não é enviado', async () => {
    const response = await request(app)
      .post('/groups/group-1/decision-processes')
      .send({
        name: 'Maioria ordinária',
        configuration: validConfiguration(),
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: 'UNAUTHENTICATED',
      message: 'Usuário mockado não encontrado.',
    });
  });

  it('retorna 401 para um usuário mockado inexistente', async () => {
    const response = await createProcess('missing-user');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('UNAUTHENTICATED');
  });

  it('permite que o administrador crie um processo', async () => {
    const response = await createProcess();

    expect(response.status).toBe(201);
    expect(response.body.process).toMatchObject({
      groupId: 'group-1',
      name: 'Maioria ordinária',
      activeVersionId: response.body.activeVersion.id,
    });
    expect(response.body.activeVersion).toMatchObject({
      processId: response.body.process.id,
      versionNumber: 1,
      createdByUserId: 'admin-group-1',
    });
  });

  it('retorna 403 quando um membro comum tenta criar um processo', async () => {
    const response = await createProcess('member-group-1');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it('retorna 403 para o administrador de outro grupo', async () => {
    const response = await createProcess('admin-group-2');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it('retorna 404 para um grupo inexistente', async () => {
    const response = await request(app)
      .post('/groups/missing-group/decision-processes')
      .set('X-Mock-User-Id', 'admin-group-1')
      .send({
        name: 'Maioria ordinária',
        configuration: validConfiguration(),
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('GROUP_NOT_FOUND');
  });

  it('usa o path do payload ao rejeitar configuração na criação', async () => {
    const response = await request(app)
      .post('/groups/group-1/decision-processes')
      .set('X-Mock-User-Id', 'admin-group-1')
      .send({
        name: 'Maioria ordinária',
        configuration: validConfiguration({ quorumPercentage: 0 }),
      });

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('VALIDATION_ERROR');
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'configuration.quorumPercentage',
          code: 'OUT_OF_RANGE',
        }),
      ]),
    );
  });

  it('cria uma nova versão e a define como ativa', async () => {
    const created = await createProcess();
    const processId = created.body.process.id;

    const response = await request(app)
      .post(`/groups/group-1/decision-processes/${processId}/versions`)
      .set('X-Mock-User-Id', 'admin-group-1')
      .send({
        configuration: validConfiguration({ quorumPercentage: 75 }),
      });

    expect(response.status).toBe(201);
    expect(response.body.activeVersion.versionNumber).toBe(2);
    expect(response.body.activeVersion.configuration.quorumPercentage).toBe(75);
    expect(response.body.process.activeVersionId).toBe(
      response.body.activeVersion.id,
    );
  });

  it('reconfigura um processo existente pela rota PUT', async () => {
    const created = await createProcess();
    const processId = created.body.process.id;

    const response = await request(app)
      .put(`/groups/group-1/decision-processes/${processId}`)
      .set('X-Mock-User-Id', 'admin-group-1')
      .send({
        configuration: validConfiguration({
          quorumPercentage: 65,
          votingMode: VotingMode.SECRET,
        }),
      });

    expect(response.status).toBe(200);
    expect(response.body.activeVersion).toMatchObject({
      versionNumber: 2,
      configuration: expect.objectContaining({
        quorumPercentage: 65,
        votingMode: VotingMode.SECRET,
      }),
    });
    expect(response.body.process.activeVersionId).toBe(
      response.body.activeVersion.id,
    );

    const versionsResponse = await request(app)
      .get(`/groups/group-1/decision-processes/${processId}/versions`)
      .set('X-Mock-User-Id', 'member-group-1');

    expect(versionsResponse.body.versions).toHaveLength(2);
    expect(
      versionsResponse.body.versions.map(
        (version: { versionNumber: number }) => version.versionNumber,
      ),
    ).toEqual([1, 2]);
    expect(
      versionsResponse.body.versions[0].configuration.quorumPercentage,
    ).toBe(50);
  });

  it('impede que um membro comum reconfigure pela rota PUT', async () => {
    const created = await createProcess();

    const response = await request(app)
      .put(`/groups/group-1/decision-processes/${created.body.process.id}`)
      .set('X-Mock-User-Id', 'member-group-1')
      .send({ configuration: validConfiguration() });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it('usa o mesmo path na reconfiguração e não cria versão', async () => {
    const created = await createProcess();
    const processId = created.body.process.id;

    const response = await request(app)
      .put(`/groups/group-1/decision-processes/${processId}`)
      .set('X-Mock-User-Id', 'admin-group-1')
      .send({
        configuration: validConfiguration({ quorumPercentage: 101 }),
      });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: 'VALIDATION_ERROR' });
    expect(response.body.details).toContainEqual(
      expect.objectContaining({
        path: 'configuration.quorumPercentage',
        code: 'OUT_OF_RANGE',
      }),
    );

    const versionsResponse = await request(app)
      .get(`/groups/group-1/decision-processes/${processId}/versions`)
      .set('X-Mock-User-Id', 'member-group-1');
    expect(versionsResponse.body.versions).toHaveLength(1);
  });

  it('não reconfigura um processo por meio de outro grupo', async () => {
    const created = await createProcess();

    const response = await request(app)
      .put(`/groups/group-2/decision-processes/${created.body.process.id}`)
      .set('X-Mock-User-Id', 'admin-group-2')
      .send({ configuration: validConfiguration() });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PROCESS_NOT_FOUND');
  });

  it('impede que um membro comum crie uma nova versão', async () => {
    const created = await createProcess();

    const response = await request(app)
      .post(
        `/groups/group-1/decision-processes/${created.body.process.id}/versions`,
      )
      .set('X-Mock-User-Id', 'member-group-1')
      .send({ configuration: validConfiguration() });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it('permite que um membro consulte o processo e sua versão ativa', async () => {
    const created = await createProcess();

    const response = await request(app)
      .get(`/groups/group-1/decision-processes/${created.body.process.id}`)
      .set('X-Mock-User-Id', 'member-group-1');

    expect(response.status).toBe(200);
    expect(response.body.process.id).toBe(created.body.process.id);
    expect(response.body.activeVersion.id).toBe(created.body.activeVersion.id);
  });

  it('impede que usuário de outro grupo consulte o processo', async () => {
    const created = await createProcess();

    const response = await request(app)
      .get(`/groups/group-1/decision-processes/${created.body.process.id}`)
      .set('X-Mock-User-Id', 'admin-group-2');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('FORBIDDEN');
  });

  it('não encontra um processo por meio de outro grupo', async () => {
    const created = await createProcess();

    const response = await request(app)
      .get(`/groups/group-2/decision-processes/${created.body.process.id}`)
      .set('X-Mock-User-Id', 'admin-group-2');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PROCESS_NOT_FOUND');
  });

  it('lista todas as versões sem alterar a primeira', async () => {
    const created = await createProcess();
    const processId = created.body.process.id;
    await request(app)
      .post(`/groups/group-1/decision-processes/${processId}/versions`)
      .set('X-Mock-User-Id', 'admin-group-1')
      .send({
        configuration: validConfiguration({ quorumPercentage: 80 }),
      });

    const response = await request(app)
      .get(`/groups/group-1/decision-processes/${processId}/versions`)
      .set('X-Mock-User-Id', 'member-group-1');

    expect(response.status).toBe(200);
    expect(response.body.versions).toHaveLength(2);
    expect(response.body.versions.map((version: { versionNumber: number }) =>
      version.versionNumber,
    )).toEqual([1, 2]);
    expect(response.body.versions[0].configuration.quorumPercentage).toBe(50);
    expect(response.body.versions[1].configuration.quorumPercentage).toBe(80);
  });

  it('retorna 404 ao consultar processo inexistente', async () => {
    const response = await request(app)
      .get('/groups/group-1/decision-processes/missing-process')
      .set('X-Mock-User-Id', 'member-group-1');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('PROCESS_NOT_FOUND');
  });

  it('retorna 400 para JSON malformado', async () => {
    const response = await request(app)
      .post('/groups/group-1/decision-processes')
      .set('X-Mock-User-Id', 'admin-group-1')
      .set('Content-Type', 'application/json')
      .send('{invalid');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('INVALID_JSON');
  });

  it('retorna 500 sem expor detalhes de um erro inesperado', async () => {
    const repository = new InMemoryDecisionProcessRepository();
    vi.spyOn(repository, 'createProcess').mockRejectedValueOnce(
      new Error('detalhe interno sensível'),
    );
    const application = createApp(repository);

    const response = await request(application)
      .post('/groups/group-1/decision-processes')
      .set('X-Mock-User-Id', 'admin-group-1')
      .send({
        name: 'Maioria ordinária',
        configuration: validConfiguration(),
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Ocorreu um erro interno no servidor.',
    });
    expect(JSON.stringify(response.body)).not.toContain('detalhe interno');
  });
});
