import type { NextFunction, Request, Response } from 'express';

import type { DecisionProcessService } from './decision-process.service';
import type { DecisionProcessConfigurationInput } from './decision-process.types';

type RequestBody = Record<string, unknown>;

function getBody(request: Request): RequestBody {
  if (
    typeof request.body === 'object' &&
    request.body !== null &&
    !Array.isArray(request.body)
  ) {
    return request.body as RequestBody;
  }

  return {};
}

export class DecisionProcessController {
  constructor(private readonly service: DecisionProcessService) {}

  createProcess = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const body = getBody(request);
      const result = await this.service.createProcess({
        groupId: request.params.groupId as string,
        name: body.name as string,
        configuration: body.configuration as DecisionProcessConfigurationInput,
        requestedByUserId: request.user!.id,
      });

      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  createVersion = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> =>
    this.handleReconfiguration(request, response, next, 201);

  reconfigureProcess = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> =>
    this.handleReconfiguration(request, response, next, 200);

  private async handleReconfiguration(
    request: Request,
    response: Response,
    next: NextFunction,
    successStatus: 200 | 201,
  ): Promise<void> {
    try {
      const body = getBody(request);
      const result = await this.service.reconfigureProcess({
        groupId: request.params.groupId as string,
        processId: request.params.processId as string,
        configuration: body.configuration as DecisionProcessConfigurationInput,
        requestedByUserId: request.user!.id,
      });

      response.status(successStatus).json(result);
    } catch (error) {
      next(error);
    }
  }

  getProcess = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const result = await this.service.getProcess({
        groupId: request.params.groupId as string,
        processId: request.params.processId as string,
        requestedByUserId: request.user!.id,
      });

      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  listVersions = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const versions = await this.service.listVersions({
        groupId: request.params.groupId as string,
        processId: request.params.processId as string,
        requestedByUserId: request.user!.id,
      });

      response.status(200).json({ versions });
    } catch (error) {
      next(error);
    }
  };
}
