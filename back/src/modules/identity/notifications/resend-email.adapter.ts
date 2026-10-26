import type { VerificationDelivery, VerificationMessage } from './verification-delivery';
    import { VerificationDeliveryError } from './verification-delivery';
    
    export interface ResendEmailAdapterOptions {
      apiKey?: string;
      fromEmail?: string;
      fetchFn?: typeof fetch;
    }
    
    /**
     * Padrão de Projeto: Adapter (Adaptador)
     * Traduz o comando padrão do sistema interno para o formato esperado pela API HTTP do Resend.
     */
    export class ResendEmailAdapter implements VerificationDelivery {
      private readonly apiKey: string;
      private readonly fromEmail: string;
      private readonly fetchFn: typeof fetch;
    
      constructor(options: ResendEmailAdapterOptions = {}) {
        this.apiKey = options.apiKey ?? process.env.RESEND_API_KEY ?? '';
        this.fromEmail = options.fromEmail ?? process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
        this.fetchFn = options.fetchFn ?? globalThis.fetch;
      }
    
      async sendVerification(message: VerificationMessage): Promise<void> {
        if (message.channel !== 'email') {
          throw new VerificationDeliveryError();
        }
    
        if (!this.apiKey) {
          throw new VerificationDeliveryError();
        }
    
        try {
          const response = await this.fetchFn('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: this.fromEmail,
              to: [message.destination],
              subject: 'Seu código de verificação de conta',
              text: `Seu código de verificação é: ${message.code}. Ele expira em 30 minutos.`,
            }),
          });
    
          if (!response.ok) {
            throw new Error(`Resend retornou status ${response.status}`);
          }
        } catch {
          // Normaliza erros de rede ou de API externa para a exceção interna do sistema
          throw new VerificationDeliveryError();
        }
      }
    }