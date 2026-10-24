import type { VerificationChannel } from '../identity.types';

/**
 * Mensagem interna que contém o código em claro somente para entrega/fixture.
 * @property {VerificationChannel} channel - Adaptador a selecionar.
 * @property {string} destination - Contato obtido da conta persistida.
 * @property {string} code - Seis dígitos que não podem ser publicados na API ou logados.
 */
export interface VerificationMessage {
  channel: VerificationChannel;
  destination: string;
  code: string;
}
/**
 * Contrato comum aos canais; sucesso significa aceitação local, não posse comprovada.
 */
export interface VerificationDelivery {
  /**
   * @param {VerificationMessage} message - Mensagem preparada pelo emissor.
   * @returns {Promise<void>} Resolve quando aceita; uma rejeição não deve consumir cota.
   * @throws {VerificationDeliveryError} Recusa normalizada do mock de entrega.
   */
  sendVerification(message: VerificationMessage): Promise<void>;
}

/**
 * Erro interno normalizado, convertido pelo emissor em VERIFICATION_DELIVERY_FAILED seguro para HTTP.
 */
export class VerificationDeliveryError extends Error {
  readonly code = 'VERIFICATION_DELIVERY_FAILED';
  /**
   * @returns {VerificationDeliveryError} Erro sem destino, código numérico ou dados de provedor.
   */
  constructor() {
    super('Falha simulada de comunicação.');
    this.name = 'VerificationDeliveryError';
  }
}

/** Adaptador local instanciado separadamente para e-mail e telefone. */
/**
 * Adaptador sem chamadas externas, com outbox e controle de falha próprios do canal.
 * @remarks WARNING: A outbox tem o código em claro; é fixture interna, não endpoint de depuração.
 */
export class MockChannelVerificationDelivery implements VerificationDelivery {
  readonly outbox: VerificationMessage[] = [];
  fail = false;

  /**
   * @param {VerificationChannel} channel - Canal exclusivo atendido pela instância.
   */
  constructor(readonly channel: VerificationChannel) {}

  /**
   * Aceita somente o próprio canal e captura uma cópia imune à mutação posterior da entrada.
   * @param {VerificationMessage} message - Destino/código já definidos pelo serviço.
   * @returns {Promise<void>} Resolve após acrescentar a mensagem aceita à outbox.
   * @throws {VerificationDeliveryError} Falha configurada ou mensagem roteada ao canal errado.
   */
  async sendVerification(message: VerificationMessage): Promise<void> {
    if (this.fail || message.channel !== this.channel) throw new VerificationDeliveryError();
    this.outbox.push({ ...message });
  }
}

/** Composição dos canais; preserva fail/outbox agregados da Issue 5.
 * Outboxes são fixtures internas: nunca publicar nem logar seus códigos.
 */
/**
 * Compõe instâncias independentes de e-mail/telefone e mantém a fixture agregada.
 * @remarks fail atua sobre os dois canais; email.fail e phone.fail permitem falhas isoladas.
 */
export class MockVerificationDelivery implements VerificationDelivery {
  readonly email = new MockChannelVerificationDelivery('email');
  readonly phone = new MockChannelVerificationDelivery('phone');
  readonly outbox: VerificationMessage[] = [];
  fail = false;

  /**
   * Encaminha ao canal correto, registrando no agregado somente envios aceitos.
   * @param {VerificationMessage} message - Mensagem de canal validado pelo emissor.
   * @returns {Promise<void>} Confirma aceitação pelo mock selecionado.
   * @throws {VerificationDeliveryError} Recusa global ou específica do adaptador.
   */
  async sendVerification(message: VerificationMessage): Promise<void> {
    if (this.fail) throw new VerificationDeliveryError();
    await this[message.channel].sendVerification(message);
    this.outbox.push({ ...message });
  }
}
