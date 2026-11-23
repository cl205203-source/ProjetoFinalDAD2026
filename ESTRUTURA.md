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
