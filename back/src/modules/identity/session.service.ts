import type { AuthIdentity, LoginData, LoginRequest, MeData } from './identity.types';

/** Implementação prevista na Issue 4. */
export interface SessionService {
  login(input: LoginRequest): Promise<LoginData>;
  logout(identity: AuthIdentity): Promise<void>;
  me(identity: AuthIdentity): Promise<MeData>;
}
