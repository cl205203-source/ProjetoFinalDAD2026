# Organização do código por módulo

Cada módulo (usuários, produtos, estoque, clientes, entregadores, pedidos e cotação) fica na **própria pasta**, com os mesmos arquivos. Assim cada integrante trabalha no seu módulo sem editar os arquivos dos outros.

## Processo main (`src/main`)

```
src/main/
  main.ts                 composição das camadas (injeção de dependências manual)
  preload.ts              ponte segura (um arquivo só, veja "Arquivos compartilhados")
  integrations.ts         APIs externas (CEP, distância, cotação, e-mail)
  compartilhado/          usado por todos os módulos
    database.ts           pool MySQL, transação() e o tipo Executor
    erros.ts              AppError
    resultado.ts          formato das respostas IPC
    controller-base.ts    registro de canais IPC com tratamento de erro
    validacao.ts          Validador (Zod), idSchema, textoOpcional
    campos-br.ts          CPF, telefone, CEP e UF (schemas Zod reutilizáveis)
    mysql-erros.ts        códigos de erro do MySQL tratados pelos módulos
  usuarios/               RF01: usuários, login e sessão
  produtos/               RF02
  estoque/                RF03/RF04: movimentações e motor de baixa/estorno
  clientes/               RF05/RF06: CRUD de clientes, consulta de CEP e distância
  entregadores/           RF07: CRUD de entregadores e disponibilidade
  pedidos/                RF08: CRUD de pedidos e itens, com baixa/estorno de estoque
  entregas/               RF09/RF10/RF11: taxa por rota, central de entregas e e-mail de confirmação
  cotacao/                RF12: canal IPC da cotação do dólar (CotacaoApi em integrations.ts)
```

Dentro de cada módulo:

| Arquivo | Responsabilidade |
|---|---|
| `<modulo>.model.ts` | entidade e tipos públicos (nunca expõe dado sensível) |
| `<modulo>.schemas.ts` | schemas Zod: toda entrada do renderer é validada aqui |
| `<modulo>.repository.ts` | único lugar com SQL (sempre prepared statements) |
| `<modulo>.service.ts` | regras de negócio e permissões (checadas no main) |
| `<modulo>.controller.ts` | canais IPC que chamam o service |

## Regras de dependência

- Fluxo: controller → service → repository → model/schemas. Nada volta.
- Todo módulo pode usar `compartilhado/`.
- Quem precisa de login usa o `SessaoService` de `usuarios/`. `usuarios/` não importa nenhum outro módulo de negócio.
- `estoque/` usa `ProdutoRepository` (`produtos/`). `produtos/` só usa o `MovimentacaoRepository` para registrar o estoque inicial.
- Os pedidos vão usar `EstoqueService.sincronizarPedido` / `estornarPedido` dentro da transação do pedido.
- Não importe o service de outro módulo se der para injetar pelo `main.ts`. Isso evita ciclos.

## Renderer (`src/renderer`)

```
src/renderer/
  index.html  renderer.ts       casca: login e abas
  compartilhado/comum.ts        Dom, Aviso, Formato, Rotulos, bridge
  <modulo>/<modulo>.dto.ts      tipos do módulo + métodos dele em PontePreload
  <modulo>/<modulo>.tela.ts     a tela
```

Os arquivos do renderer são scripts globais (sem `import`/`export`). A interface `PontePreload` é declarada em partes, uma por módulo, e o TypeScript junta todas.

## Como criar um módulo novo (ex.: clientes)

1. Criar `src/main/clientes/` com model, schemas, repository, service e controller (copie o padrão de `produtos/`).
2. `main.ts`: importar, instanciar repository e service e chamar `new ClienteController(...).registrar()`.
3. `preload.ts`: acrescentar o bloco `// Clientes` com os métodos.
4. Renderer: criar `src/renderer/clientes/clientes.dto.ts` e `clientes.tela.ts`.
5. `index.html`: seção da aba e `<script src="../../dist/renderer/clientes/clientes.tela.js">` antes de `renderer.js`.
6. `renderer.ts`: registrar a aba.

## Arquivos compartilhados (onde acontecem conflitos de merge)

`main.ts`, `preload.ts`, `index.html`, `renderer.ts` e `compartilhado/comum.ts` são tocados por todo módulo novo. Faça mudanças pequenas, commits pequenos e `git pull --rebase` antes de enviar.

Por que `preload.ts` e o renderer não são divididos em módulos: o preload roda em `sandbox: true` e só consegue importar `electron`; o renderer roda como scripts globais por causa da CSP (`script-src 'self'`).

## Clientes, entregadores e configuração da loja

- `.env`: informe `LOJA_CEP` (ou `LOJA_LATITUDE` e `LOJA_LONGITUDE`) para o cálculo de distância (RF06).
- `integrations.ts`: `CepApi` (ViaCEP, com BrasilAPI de reserva) e `DistanciaApi` (Nominatim/OpenStreetMap + Haversine). Falha da API de distância não impede o cadastro: a distância fica vazia e é recalculada na próxima edição.
- Pedidos: usam `clientes.id` / `entregadores.id` em `pedidos.cliente_id` / `pedidos.entregador_id` e `clientes.distancia_km` na precificação da entrega. O módulo `pedidos/` implementa o RF08: os preços unitários são lidos de `produtos.preco_venda` no main (nunca vêm da tela), o total é `soma(subtotais) + valor_frete`, e a baixa/estorno de estoque chama `EstoqueService.sincronizarPedido`/`estornarPedido` dentro da mesma transação. Pedidos cancelados podem ser excluídos pelo Admin; entregues e ativos ficam no histórico (RN04).
- Cotação (RF12): `CotacaoApi` consulta a AwesomeAPI (USD/BRL comercial) com reserva no PTAX do Banco Central e cache de 10 minutos. A cotação aparece na aba Produtos para apoiar a precificação de itens importados (RN03).

## Detalhamento da implementação (RF08/RF12)

### RF08 — Backend (model, schemas e repository)
- `src/main/pedidos/pedido.model.ts`: define `StatusPedido`, a entidade `Pedido`, itens e os tipos públicos usados pelo renderer.
- `src/main/pedidos/pedido.schemas.ts`: valida com Zod os dados recebidos do renderer (cliente, entregador opcional, distância, frete, status inicial e itens com `produtoId` e `quantidade`).
- `src/main/pedidos/pedido.repository.ts`: concentra o SQL das tabelas `pedidos` e `itens_pedido`; faz INSERT/UPDATE/DELETE em transação e monta os JOINs com cliente, entregador e usuário.

### RF08 — Backend (service, controller e regras)
- `src/main/pedidos/pedido.service.ts`: lê o preço unitário de `produtos.preco_venda` no main; calcula `valor_total = soma(subtotais) + valor_frete`.
- A baixa/estorno de estoque usa `EstoqueService.sincronizarPedido`/`estornarPedido` dentro da mesma transação do pedido.
- RN02: o status `SAIU_PARA_ENTREGA` exige entregador vinculado.
- RN04: só Admin pode excluir, e apenas pedidos `CANCELADO`; pedidos ativos/entregues permanecem no histórico.
- `src/main/pedidos/pedido.controller.ts`: expõe os canais IPC `pedidos:listar|obter|criar|atualizar|alterarStatus|cancelar|excluir`.

### RF08 — Renderer e integração
- `src/renderer/pedidos/pedidos.dto.ts`: declara os tipos globais e estende a `PontePreload` com os métodos de pedidos.
- `src/renderer/pedidos/pedidos.tela.ts`: implementa a aba Pedidos com filtro, formulário, itens dinâmicos, troca de status, cancelamento e exclusão.
- Integração: `main.ts` registra o `PedidoController`; `preload.ts` expõe os métodos; `index.html` adiciona a aba/seção; `renderer.ts` registra a `PedidosTela`.

### RF12 — Cotação do dólar
- `src/main/integrations.ts` (`CotacaoApi`): consulta USD/BRL na AwesomeAPI, com fallback para PTAX do Banco Central e cache de 10 minutos.
- `src/main/cotacao/cotacao.controller.ts`: canal IPC `cotacao:dolar`, com mensagem amigável quando a cotação está indisponível.
- Renderer: `preload.ts` expõe `consultarCotacaoDolar`; a aba Produtos exibe o card de cotação e o botão "Atualizar cotação" para apoiar a RN03.

## Detalhamento da implementação (RF09/RF10/RF11)

### RF09 — Backend (rotas, taxa e persistência)
- `src/main/integrations.ts` (`DistanciaApi.calcularRota`): geocodifica loja e cliente com Nominatim/OpenStreetMap e consulta o OSRM (`router.project-osrm.org`) para obter distância e duração reais da rota. Se o OSRM falhar, usa a estimativa Haversine em linha reta como fallback; se nem a geocodificação funcionar, devolve `null` sem interromper a venda.
- `src/main/entregas/taxa-entrega.service.ts` (`TaxaEntregaService.calcular`): calcula `duracaoMin`, `taxaEntrega` e `previsaoEntrega` a partir da distância. Aplica `taxaBase + taxaPorKm × distânciaKm` e a regra de frete grátis quando o valor dos itens atinge `ENTREGA_FRETE_GRATIS_ACIMA`. A previsão é `agora + tempo de preparo + duração do trajeto`.
- `src/main/entregas/entrega.model.ts`: define `TaxaEntregaPublica`, com `distanciaKm`, `duracaoMin`, `taxaEntrega`, `previsaoEntrega`, `origem` (`OSRM`, `HAVERSINE`, `DISTANCIA_CADASTRADA` ou `INDISPONIVEL`), `freteGratis` e `aviso`.
- `src/main/pedidos/pedido.service.ts` (`criar`/`atualizar`): refaz o cálculo no main, nunca confia no frete/distância da tela e grava `distancia_km`, `valor_frete` e `previsao_entrega` no pedido. Os valores enviados pelo renderer só são usados como fallback quando o cálculo retorna `null`.
- `src/main/pedidos/pedido.repository.ts` e `pedido.model.ts`: incluem `previsao_entrega` no SELECT/INSERT/UPDATE e expõem `previsaoEntrega` em `PedidoPublico`. Não é necessária tabela nova: a coluna já existe em `pedidos`.
- Fallbacks do cálculo, em ordem: OSRM → Haversine → `clientes.distancia_km` (distância cadastrada no RF06) → `INDISPONIVEL` com aviso para recalcular o cliente.

### RF09 — Renderer e integração
- `src/main/entregas/entrega.controller.ts`: expõe `entregas:calcularTaxa`, chamado pelo `EntregaService.calcularTaxa`.
- `src/main/preload.ts`: expõe `calcularTaxaEntrega({ clienteId, valorItens })`.
- `src/renderer/entregas/entregas.dto.ts`: declara `TaxaEntregaDTO` e estende a `PontePreload`.
- `src/renderer/pedidos/pedidos.tela.ts`: recalcula a taxa ao trocar o cliente, alterar produto/quantidade, remover item ou clicar em **Calcular taxa de entrega**. Preenche os campos somente leitura `ped-distancia` e `ped-frete` e o painel `ped-entrega-*`.
- `src/renderer/index.html`: campos de distância/frete como `readonly`, painel com distância, duração, taxa, previsão e fonte, além da mensagem de aviso do cálculo.

### RF10 — Backend (painel, vínculo e ciclo de vida)
- `src/main/entregas/entrega.repository.ts`: consulta os pedidos ativos (`PENDENTE`, `EM_SEPARACAO`, `SAIU_PARA_ENTREGA`) com JOIN em `clientes` e `entregadores`, monta o endereço e o resumo dos itens, lista entregadores ativos com status `DISPONIVEL` e executa o `UPDATE` de vínculo com prepared statement.
- `src/main/entregas/entrega.service.ts` (`painel`): agrupa os pedidos por entregador, separa os pedidos sem entregador e calcula os indicadores de entregas ativas, pedidos em rota, entregadores em rota e pedidos sem responsável.
- `src/main/entregas/entrega.service.ts` (`vincular`): exige `ADMIN`/`ATENDENTE`, pedido não finalizado e entregador ativo com status `DISPONIVEL`; faz o vínculo em transação, coloca o entregador em `EM_ROTA` se o pedido já saiu para entrega e libera o entregador anterior quando ele não tem outras entregas em rota.
- `src/main/entregas/entrega.service.ts` (`alterarStatus`): valida o ciclo `PENDENTE → EM_SEPARACAO → SAIU_PARA_ENTREGA → ENTREGUE` (com `CANCELADO` em qualquer etapa ativa). Cancelamentos delegam ao `PedidoService.cancelar` para estornar o estoque (RF03).
- `src/main/pedidos/pedido.service.ts`: sincroniza a disponibilidade do entregador. `SAIU_PARA_ENTREGA` define `EM_ROTA`; `ENTREGUE`/`CANCELADO` devolvem para `DISPONIVEL` se não houver outra entrega ativa; a troca de entregador libera o anterior quando ele fica sem entregas.
- `src/main/entregas/entrega.controller.ts`: expõe `entregas:painel`, `entregas:vincular` e `entregas:alterarStatus`.

### RF10 — Renderer e integração
- `src/main/preload.ts`: expõe `painelEntregas`, `vincularEntregador` e `alterarStatusEntrega`.
- `src/renderer/entregas/entregas.dto.ts`: declara `EntregaDTO`, `EntregadorComEntregasDTO`, `EntregadorDisponivelDTO`, `PainelEntregasDTO` e os métodos da `PontePreload`.
- `src/renderer/entregas/entregas.tela.ts`: atualiza o painel a cada 5 segundos, sem sobrepor requisições; mostra cartões por entregador, pedidos sob responsabilidade, pedidos sem entregador, indicadores, timestamp e erro. Oferece o `select` de entregadores disponíveis + **Vincular** e os botões de ciclo de vida (**Iniciar separação**, **Saiu para entrega**, **Entregue**, **Cancelar**).
- O polling é interrompido em `EntregasTela.parar()`, chamado pelo `renderer.ts` ao trocar de aba e no logout.
- `src/renderer/renderer.ts`: inclui a aba `entregas` em `Aba`/`ABAS`, instancia `EntregasTela` e ativa a tela.
- `src/renderer/index.html`: aba e seção da Central de Entregas com os cards de resumo, o botão **Atualizar agora**, o timestamp, o alerta de erro, a legenda dos cinco status e os containers `painel-entregas`/`entregas-vazio`.

### RF11 — Backend (e-mail de confirmação)
- `src/main/entregas/confirmacao-email.service.ts` (`ConfirmacaoPedidoEmailService.enviar`): busca o e-mail do cliente e monta as versões HTML e texto do e-mail com itens, quantidades, subtotal, frete, total, endereço de entrega, previsão e entregador. Os textos são escapados antes de entrar no HTML.
- `src/main/integrations.ts` (`EmailApi`): envia via `nodemailer` usando `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SEGURANCA`, `EMAIL_REMETENTE` e `EMAIL_REMETENTE_NOME`. Sem `SMTP_HOST`, gera o e-mail em modo simulação e registra no log do processo main.
- `src/main/pedidos/pedido.service.ts` (`criar`): dispara o e-mail somente após o commit da transação, nunca deixa uma falha de e-mail cancelar o pedido e devolve `emailConfirmacao` (`enviado` + `mensagem`) junto ao `PedidoPublico`.
- `src/main/pedidos/pedido.model.ts`: define `ResultadoEmailConfirmacao` e o campo opcional `emailConfirmacao` em `PedidoPublico`.
- `src/main/entregas/entrega.model.ts`: `previsaoEntrega` é usada tanto no painel quanto no corpo do e-mail.
- Se o cliente não tiver e-mail cadastrado ou o SMTP recusar o destinatário, o pedido permanece válido e a tela informa o motivo.

### RF11 — Renderer e integração
- `src/main/preload.ts`: o retorno de `criarPedido` segue o tipo `PedidoPublico`, incluindo `emailConfirmacao`.
- `src/renderer/pedidos/pedidos.dto.ts`: acrescenta `previsaoEntrega` e `emailConfirmacao?` ao `PedidoDTO`.
- `src/renderer/pedidos/pedidos.tela.ts`: após criar o pedido, mostra no `Aviso` se o e-mail foi enviado ou se o envio falhou, sem esconder o sucesso da gravação.
- `src/renderer/index.html`: nota fixa no formulário explicando que o e-mail de confirmação é automático e contém itens, valores e previsão de entrega.

### Configuração necessária (RF09/RF11)
- `.env`/`.env.example`: `LOJA_CEP` ou `LOJA_LATITUDE` + `LOJA_LONGITUDE` para a origem das rotas do RF09.
- Tarifa: `ENTREGA_TAXA_BASE`, `ENTREGA_TAXA_POR_KM`, `ENTREGA_FRETE_GRATIS_ACIMA`, `ENTREGA_TEMPO_PREPARO_MIN` e `ENTREGA_VELOCIDADE_KMH`.
- E-mail: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SEGURANCA`, `EMAIL_REMETENTE` e `EMAIL_REMETENTE_NOME`. Sem SMTP, o RF11 funciona em modo simulação/log.
