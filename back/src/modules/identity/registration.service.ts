import type { RegisterData, RegisterRequest } from './identity.types';

/** Implementação e validações previstas na Issue 3. */
export interface RegistrationService {
  register(input: RegisterRequest): Promise<RegisterData>;
}
