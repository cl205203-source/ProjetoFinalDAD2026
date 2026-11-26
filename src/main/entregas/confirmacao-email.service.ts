// [RF11] Disparo automático de e-mail de confirmação do pedido (itens, valores, endereço e previsão).
// Executado após o commit da transação sem bloquear ou cancelar o pedido em caso de falha de envio ou SMTP não configurado.
import { ClienteRepository } from '../clientes/cliente.repository';
import { EmailApi } from '../integrations';
import { PedidoPublico, ResultadoEmailConfirmacao, StatusPedido } from '../pedidos/pedido.model';

export class ConfirmacaoPedidoEmailService {
  /** [RF11] Texto, rótulo e cor do e-mail de acordo com o status atual do pedido. */
  private static readonly STATUS_EMAIL: Record<
    StatusPedido,
    { titulo: string; rotulo: string; intro: string; subtitulo: string; cor: string }
  > = {
    PENDENTE: {
      titulo: 'recebido',
      rotulo: 'Pendente',
      intro: 'Recebemos seu pedido e já estamos preparando tudo para o seu pet.',
      subtitulo: 'Obrigado por comprar no Pet Shop Delivery!',
      cor: '#198754',
    },
    EM_SEPARACAO: {
      titulo: 'em separação',
      rotulo: 'Em separação',
      intro: 'Seu pedido está sendo separado pela nossa equipe.',
      subtitulo: 'Obrigado por comprar no Pet Shop Delivery!',
      cor: '#0d6efd',
    },
    SAIU_PARA_ENTREGA: {
      titulo: 'saiu para entrega',
      rotulo: 'Saiu para entrega',
      intro: 'Seu pedido saiu para entrega e está a caminho.',
      subtitulo: 'Obrigado por comprar no Pet Shop Delivery!',
      cor: '#fd7e14',
    },
    ENTREGUE: {
      titulo: 'entregue',
      rotulo: 'Entregue',
      intro: 'Seu pedido foi entregue. Obrigado por comprar no Pet Shop Delivery!',
      subtitulo: 'Pedido concluído com sucesso!',
      cor: '#198754',
    },
    CANCELADO: {
      titulo: 'cancelado',
      rotulo: 'Cancelado',
      intro: 'Seu pedido foi cancelado. Se precisar de ajuda, fale com a nossa loja.',
      subtitulo: 'Pedido cancelado',
      cor: '#dc3545',
    },
  };

  constructor(
    private readonly clientes: ClienteRepository,
    private readonly emailApi: EmailApi,
  ) {}

  /**
   * [RF11] Monta o resumo detalhado do pedido e dispara o e-mail ao cliente com o status atual
   * (recebido, em separação, saiu para entrega, entregue ou cancelado).
   * Contém: resumo dos itens, valores (subtotal, taxa de entrega/frete, total), endereço completo e previsão de entrega.
   * Nunca lança exceção: falhas de envio retornam um status descritivo sem afetar a persistência do pedido.
   * Quando em modo simulação (sem SMTP_HOST configurado), o serviço de e-mail grava o HTML
   * na pasta local ./emails e retorna enviado: true com mensagem amigável para não disparar falso alerta de erro na interface.
   */
  async enviar(pedido: PedidoPublico): Promise<ResultadoEmailConfirmacao> {
    try {
      const cliente = await this.clientes.buscarPorId(pedido.clienteId);
      const para = cliente?.email?.trim();
      if (!cliente || !para) {
        return { enviado: false, mensagem: 'Cliente sem e-mail cadastrado.' };
      }

      // [RF11] Consolidação dos valores (subtotal dos itens, frete e valor total)
      const subtotal = ConfirmacaoPedidoEmailService.arredondar(
        pedido.itens.reduce((soma, item) => soma + item.subtotal, 0),
      );
      const freteTexto = pedido.valorFrete > 0 ? ConfirmacaoPedidoEmailService.moeda(pedido.valorFrete) : 'Grátis';
      const previsaoTexto = pedido.previsaoEntrega
        ? new Date(pedido.previsaoEntrega).toLocaleString('pt-BR')
        : 'A confirmar';
      const entregadorTexto = pedido.entregadorNome ?? 'Ainda não definido';
      const endereco = ConfirmacaoPedidoEmailService.formatarEndereco(cliente);
      const status = ConfirmacaoPedidoEmailService.STATUS_EMAIL[pedido.statusPedido];
      const titulo = `Pedido #${pedido.id} ${status.titulo}`;
      const assunto = `${titulo} - Pet Shop Delivery`;

      // [RF11] Tabela HTML com resumo dos produtos
      const linhasHtml = pedido.itens
        .map(
          (item) => `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:center;">${item.quantidade}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${ConfirmacaoPedidoEmailService.escaparHtml(item.produtoNome)}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${ConfirmacaoPedidoEmailService.moeda(item.subtotal)}</td>
            </tr>`,
        )
        .join('');

      // [RF11] Layout do e-mail em HTML responsivo
      const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="padding:20px 24px;background:${status.cor};color:#ffffff;">
      <h1 style="margin:0;font-size:20px;">${titulo}</h1>
      <p style="margin:6px 0 0;font-size:14px;">${status.subtitulo}</p>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 12px;">Olá, <strong>${ConfirmacaoPedidoEmailService.escaparHtml(cliente.nome)}</strong>!</p>
      <p style="margin:0 0 16px;font-size:14px;">${status.intro}</p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="padding:8px;text-align:center;">Qtd.</th>
            <th style="padding:8px;text-align:left;">Produto</th>
            <th style="padding:8px;text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>${linhasHtml}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding:8px;text-align:right;">Subtotal</td>
            <td style="padding:8px;text-align:right;">${ConfirmacaoPedidoEmailService.moeda(subtotal)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:8px;text-align:right;">Frete</td>
            <td style="padding:8px;text-align:right;">${freteTexto}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:8px;text-align:right;font-weight:bold;">Total</td>
            <td style="padding:8px;text-align:right;font-weight:bold;">${ConfirmacaoPedidoEmailService.moeda(pedido.valorTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="margin-top:20px;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;font-size:14px;">
        <p style="margin:0 0 6px;"><strong>Status do pedido</strong></p>
        <p style="margin:0 0 12px;">${status.rotulo}</p>
        <p style="margin:0 0 6px;"><strong>Endereço de entrega</strong></p>
        <p style="margin:0 0 12px;">${ConfirmacaoPedidoEmailService.escaparHtml(endereco)}</p>
        <p style="margin:0 0 6px;"><strong>Previsão de entrega</strong></p>
        <p style="margin:0 0 12px;">${ConfirmacaoPedidoEmailService.escaparHtml(previsaoTexto)}</p>
        <p style="margin:0 0 6px;"><strong>Entregador</strong></p>
        <p style="margin:0;">${ConfirmacaoPedidoEmailService.escaparHtml(entregadorTexto)}</p>
      </div>

      <p style="margin:20px 0 0;font-size:12px;color:#6b7280;">Este é um e-mail automático; não é necessário responder.</p>
    </div>
  </div>
</body>
</html>`;

      // [RF11] Versão em texto simples para clientes de e-mail sem suporte a HTML
      const texto = [
        `${titulo} - Pet Shop Delivery`,
        '',
        `Olá, ${cliente.nome}!`,
        status.intro,
        '',
        ...pedido.itens.map((item) => `- ${item.quantidade}x ${item.produtoNome}: ${ConfirmacaoPedidoEmailService.moeda(item.subtotal)}`),
        '',
        `Subtotal: ${ConfirmacaoPedidoEmailService.moeda(subtotal)}`,
        `Frete: ${freteTexto}`,
        `Total: ${ConfirmacaoPedidoEmailService.moeda(pedido.valorTotal)}`,
        '',
        `Status do pedido: ${status.rotulo}`,
        `Endereço de entrega: ${endereco}`,
        `Previsão de entrega: ${previsaoTexto}`,
        `Entregador: ${entregadorTexto}`,
        '',
        'Este é um e-mail automático; não é necessário responder.',
      ].join('\n');

      return await this.emailApi.enviar({
        para,
        assunto,
        texto,
        html,
      });
    } catch (erro) {
      // [RF11] Falha inesperada no e-mail nunca derruba a criação do pedido
      console.error('[ConfirmacaoPedidoEmailService] [RF11] falha ao preparar o e-mail:', (erro as Error).message);
      return { enviado: false, mensagem: 'Não foi possível enviar o e-mail de confirmação.' };
    }
  }

  private static formatarEndereco(cliente: {
    logradouro: string;
    numero: string;
    complemento: string | null;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  }): string {
    const complemento = cliente.complemento ? ` - ${cliente.complemento}` : '';
    return `${cliente.logradouro}, ${cliente.numero}${complemento} - ${cliente.bairro}, ${cliente.cidade}/${cliente.uf} - CEP ${cliente.cep}`;
  }

  private static escaparHtml(valor: string): string {
    return valor
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private static moeda(valor: number): string {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  private static arredondar(valor: number): number {
    return Math.round((valor + Number.EPSILON) * 100) / 100;
  }
}
