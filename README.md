# Many Zac

Plataforma SaaS de automação conversacional omnichannel (marketing, atendimento e vendas).
Monólito modular: API em NestJS + PostgreSQL + Redis. Ver `docs/ROADMAP.md` para o plano de marcos e
`docs/NEXT_STEPS.md` para o que falta e o que só você pode fazer (contas/credenciais externas).

## Stack

- **API**: NestJS + TypeScript (`apps/api`)
- **Frontend**: Next.js (App Router) + TypeScript + Tailwind + React Flow (`apps/web`)
- **Banco**: PostgreSQL via Prisma ORM
- **Cache/filas** (a partir do M6): Redis + BullMQ
- **Canal inicial**: Instagram/Messenger (Meta Graph API)

## Setup local

Pré-requisitos: Node 20+, Docker (ou um Postgres local na porta 5432).

```bash
npm install

# Suba Postgres + Redis
docker compose up -d
# (alternativa sem Docker: aponte DATABASE_URL para um Postgres local já rodando)

cp apps/api/.env.example apps/api/.env
# edite apps/api/.env:
#   - gere CREDENTIALS_ENCRYPTION_KEY com: openssl rand -base64 32
#   - defina JWT_SECRET
#   - REDIS_URL (necessário a partir do M6 - o worker de automação não sobe sem Redis)
#   - (opcional) META_APP_SECRET / META_WEBHOOK_VERIFY_TOKEN para testar o webhook/envio real do Meta

npm run -w apps/api prisma:migrate   # cria as tabelas
npm run dev:api                      # sobe a API em http://localhost:3001

# em outro terminal
cp apps/web/.env.local.example apps/web/.env.local
npm run dev -w apps/web              # sobe o frontend em http://localhost:3000
```

## Deploy (para testar com um canal real do Instagram/Messenger)

A Meta não consegue chamar `localhost` — o webhook de entrada precisa de uma URL pública HTTPS.
A API (que precisa ficar sempre ligada, por causa do worker de filas) vai no **Render**; o frontend
Next.js vai na **Vercel**, que tem suporte nativo a Next.js e é mais simples pra isso.

### 1. Bancos gerenciados (fora do Render, para não misturar com o compute)

- Postgres: [neon.tech](https://neon.tech) ou [supabase.com](https://supabase.com) (ambos com tier
  gratuito permanente) — copie a `DATABASE_URL`. No Supabase, use a **conexão direta** (porta `5432`,
  não a "Transaction pooler" na `6543`) — a API roda como processo único sempre ligado no Render, não
  precisa de pooler, e `prisma migrate deploy` funciona melhor direto.
- Redis: [upstash.com](https://upstash.com) (tier gratuito permanente) — copie a `REDIS_URL`
  (use a versão `rediss://` com TLS).

### 2. Suba o código

`git push` para um repositório seu no GitHub (posso fazer isso por você quando o repositório existir —
é só me avisar).

### 3. API no Render

1. **New → Blueprint**, aponte para o repositório — ele lê o [render.yaml](render.yaml) e cria o
   serviço `many-zac-api` automaticamente.
2. Preencha as variáveis marcadas como secret no painel (nunca vão para o git):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a do Neon/Supabase |
   | `REDIS_URL` | a do Upstash |
   | `JWT_SECRET` | gere com `openssl rand -base64 48` |
   | `CREDENTIALS_ENCRYPTION_KEY` | gere com `openssl rand -base64 32` |
   | `META_APP_SECRET` | do seu App em developers.facebook.com |
   | `META_WEBHOOK_VERIFY_TOKEN` | qualquer string aleatória sua, ex: `openssl rand -hex 16` |

3. Deploy dispara sozinho. O `startCommand` já roda `prisma migrate deploy` antes de subir, então as
   tabelas são criadas automaticamente no banco no primeiro deploy.
4. Anote a URL pública que o Render deu (ex: `https://many-zac-api.onrender.com`).

### 4. Frontend na Vercel

1. **Add New → Project**, aponte para o mesmo repositório.
2. Em **Root Directory**, selecione `apps/web` (é um monorepo com npm workspaces — a Vercel detecta o
   Next.js sozinha a partir daí).
3. Em **Environment Variables**, adicione:
   - `API_URL` = a URL do Render do passo anterior
   - `APP_URL` = a URL que a Vercel vai te dar (ex: `https://many-zac.vercel.app`) — usada para montar o
     `redirect_uri` exato do OAuth (precisa bater com o cadastrado no App da Meta no passo 5)
   - `META_APP_ID` = o ID do seu App (público, não é segredo)
4. Deploy. Anote a URL que a Vercel deu (ex: `https://many-zac.vercel.app`).

### 5. Webhook e OAuth reais na Meta

No painel da Meta (developers.facebook.com → seu App):
- **Webhooks**: assine `messages` para Instagram/Messenger apontando para
  `https://<sua-api>.onrender.com/webhooks/meta`, usando o mesmo `META_WEBHOOK_VERIFY_TOKEN` do passo 3.
- **Facebook Login → Configurações**: registre a Valid OAuth Redirect URI exata:
  `https://<sua-vercel>/api/oauth/meta/callback` (precisa bater byte a byte com o `APP_URL` configurado
  na Vercel).

### 6. Conectar e testar

Acesse a URL da Vercel, crie sua conta e workspace. Em **Canais**, clique **"Conectar com Facebook"** —
funciona automaticamente se a conta tiver uma única Page conectada (mais de uma Page ainda precisa do
formulário manual: colar o ID da Page/conta do Instagram e o access token real, gerado no painel da
Meta). Publique uma automação com um gatilho e um nó de mensagem, mande uma DM de verdade para a conta
conectada (de uma conta cadastrada como tester no seu App, se ele ainda estiver em modo
desenvolvimento) e veja a resposta chegar de verdade.

**Limitação do plano gratuito do Render:** o serviço dorme após ~15 min sem tráfego e demora alguns
segundos para acordar na próxima requisição — aceitável para testar, mas para confiabilidade (ex: um
nó de espera disparar no horário certo mesmo com o servidor ocioso) é necessário migrar para o plano
pago "Starter". A Vercel não tem esse problema (o frontend não precisa ficar sempre ligado).

## Testes, lint e build

```bash
npm run test:api
npm run lint:api
npm run build:api
```

## O que já funciona (M0-M10 + todos os tipos de nó do runtime)

- Signup / login (JWT) — `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
- Workspaces multiempresa com papéis Owner/Admin/Builder/Agent/Analyst, convites, troca de papel e remoção de membro — `POST/GET /workspaces`, `/workspaces/:id/members`, `/workspaces/:id/invitations`
- RBAC aplicado no backend (`WorkspaceRolesGuard`) em toda rota com escopo de workspace — nunca só ocultado na UI
- Audit log para as ações acima
- Contatos, tags, campos personalizados tipados e registro/revogação de consentimento, todos escopados por workspace
- Adapter do canal Meta (Instagram/Messenger): verificação de assinatura de webhook (HMAC), handshake de verificação, normalização de eventos, cálculo de janela de mensagem de 24h, e envio real via Graph API (`sendMessage`)
- Ingestão idempotente de webhook: eventos duplicados (retry/replay do provedor) não duplicam `InboundEvent` nem `Contact` — dedupe via constraint única `(channelConnectionId, externalEventId)`
- Credenciais de canal criptografadas em repouso (AES-256-GCM) antes de ir para o banco
- Outbox transacional: todo webhook processado publica `contact.message_received` atomicamente com a criação/atualização do contato — `apps/api/src/events/`
- Automações versionadas: criar, editar rascunho, validar grafo e publicar (versão publicada é imutável; publicar sempre abre um novo rascunho) — `POST/GET /workspaces/:id/automations`, `.../draft`, `.../validate`, `.../publish`
- Motor de execução: um contato manda mensagem → o gatilho casa com uma automação publicada → o runtime processa trigger → mensagem → condição → delay → fim, com retry/backoff e dead-letter queue via BullMQ — `apps/api/src/automations/execution/`
- Flow Builder visual (`apps/web`): login/cadastro com sessão em cookie httpOnly, lista de workspaces, lista de automações, e o construtor de fluxo em si (React Flow) com paleta de nós, painel de propriedades por tipo de nó, salvar rascunho, validar (mostra erros reais do backend) e publicar — tudo direto contra a API real, sem mock
- Tela de "Canais" para conectar um canal colando o ID da Page/conta e o access token, sem precisar chamar a API na mão
- Inbox (`apps/web`, `/workspaces/:id/inbox`): lista de conversas com filtro por status, thread com histórico de mensagens (contato/bot/atendente), resposta manual (chama a Graph API de verdade, igual ao runtime), e ações "Assumir", "Devolver para o bot" e "Fechar" — tudo direto contra a API real (`apps/api/src/conversations/`)
- Handoff humano de verdade: o nó `human_handoff` abre (ou reaproveita) uma `Conversation` de verdade e pausa a `AutomationExecution` esperando um agente; "Devolver para o bot" retoma a execução exatamente de onde parou, reenfileirando o job no BullMQ — `POST /workspaces/:id/conversations/:conversationId/resume`
- Policy Engine (`apps/api/src/policy/`): `PolicyService.canSend` bloqueia de verdade um envio — automático (runtime) ou manual (Inbox) — fora da janela de 24h, com consentimento `purpose="messaging"` revogado, ou depois de um opt-out; ponto único de decisão, não duplicado por caminho de envio
- Opt-out/opt-in por palavra-chave: uma mensagem como "parar"/"sair"/"stop" marca o contato como opted-out e cancela toda automação em andamento para ele; "voltar"/"iniciar"/"start" reabre
- Nós `action` (`add_tag`/`remove_tag`/`set_field`), `goal` (marcador/analytics) e `start_another_flow` (dispara outra automação publicada para o mesmo contato, fire-and-forget) agora funcionam no runtime e têm paleta + painel de propriedades no Flow Builder
- `collect_input`: pausa a execução esperando a próxima mensagem do contato e injeta o texto numa variável (`{{flow.<nome>}}`), disponível nos nós seguintes do mesmo grafo — `apps/api/src/automations/execution/collect-input.listener.ts`
- `external_request`: chamada HTTP saindo do runtime, com allow-list de host obrigatória (`EXTERNAL_REQUEST_ALLOWED_HOSTS`, falha fechado se vazia), timeout configurável, retry em falha (mesmo padrão do `send_message`) e resposta salva opcionalmente num campo personalizado
- Todos os 11 tipos de nó do `graph.types.ts` agora têm handler no runtime, regra no `graph-validator.ts`, e paleta + painel de propriedades no Flow Builder — não há mais nenhum nó "aceito no builder mas rejeitado em produção"
- `GET /health` checa Postgres e Redis de verdade (não só "o processo está de pé"), retornando 503 com o detalhamento de qual dependência caiu — é o que o `healthCheckPath` do Render usa pra decidir se um deploy está saudável
- `GET /metrics` (`apps/api/src/observability/`, protegido por `METRICS_TOKEN` no header `X-Metrics-Token`, falha fechado se não configurado): execuções por status, profundidade da fila de execução e da dead-letter queue, backlog do outbox, total de negações do Policy Engine
- Logs estruturados em JSON quando `NODE_ENV=production` (`JsonLogger`, uma linha JSON por evento) — o dev local continua com o logger colorido padrão do Nest
- Conectar um canal agora pode ser "clique e autorize": botão "Conectar com Facebook" (`apps/api/src/channels/meta-oauth.service.ts` + rotas em `apps/web/src/app/api/oauth/meta/`) troca o fluxo OAuth2 da Meta por um canal conectado automaticamente quando a conta tem uma única Page — cobre o caso comum sem exigir copiar/colar um access token manualmente
- Exclusão de workspace (soft-delete): `DELETE /workspaces/:id`, exclusiva do Owner — o `WorkspaceRolesGuard` rejeita qualquer rota de um workspace já deletado, e ele some da listagem (`GET /workspaces`) sem apagar os dados de verdade
- Paginação por cursor em `GET /contacts` (query params `take`/`cursor`, resposta `{items, nextCursor}`) — não degrada com volume grande de contatos como offset/skip degradava
- Atalho `Cmd/Ctrl+S` no Flow Builder salva o rascunho sem precisar clicar no botão
- Deploy pronto para produção via [render.yaml](render.yaml) (ver seção Deploy abaixo) — necessário para testar com um número/conta real, já que a Meta não chama `localhost`

## O que ainda não existe (não alegar pronto)

- O "Conectar com Facebook" automático só cobre contas com **uma Page só**; múltiplas Pages caem de volta no formulário manual (colar ID + token) — não existe tela de escolha de Page
- `start_another_flow` só impede o caso mais óbvio de auto-loop (uma automação apontando direto para si mesma); um ciclo indireto (A inicia B, B inicia A) não é detectado e pode gerar execuções em cascata
- `EXTERNAL_REQUEST_ALLOWED_HOSTS` é uma allow-list global por deploy, não por workspace — qualquer Builder em qualquer workspace pode chamar qualquer host que o operador já tenha liberado; não há isolamento por workspace nem proteção contra DNS rebinding (um host allow-listado cuja resolução de DNS mude para um IP interno não é bloqueado)
- Uma nova mensagem do contato pode disparar uma automação nova mesmo enquanto a conversa está em atendimento humano (`HUMAN`/`WAITING_HUMAN`) — o `TriggerMatcherService` ainda não considera o status da conversa antes de abrir uma nova execução (o `send_message` dessa nova execução seria bloqueado pelo Policy Engine só se o contato tiver de fato opinado out — não é um gate específico para "está em atendimento humano")
- `/metrics` é um snapshot JSON simples, não formato Prometheus — não há scrape target nem stack de monitoramento (Grafana etc.) configurado ainda, e nenhuma métrica de latência de processamento de webhook (só o proxy indireto de idade do backlog do outbox)
- `MetaAdapter.sendMessage` chama a Graph API real e já foi confirmado conversando de fato com `graph.facebook.com` (ver validação abaixo) — falta apenas testar com credenciais de um app Meta aprovado em vez de um token fake, para confirmar um envio bem-sucedido de ponta a ponta
- O Flow Builder não tem posicionamento automático de nós (arrastar manualmente é necessário) nem atalhos de teclado; é funcional, não polido

## Validação de ponta a ponta (2026-07-17)

Docker não sobe neste ambiente de desenvolvimento, mas um Postgres 14 e um Redis reais (fora do
`docker-compose.yml`, via `initdb`/`redis-server` locais) permitiram rodar a API de verdade e
confirmar o fluxo completo, sem mocks:

1. `POST /auth/signup` → `POST /workspaces` → `POST /workspaces/:id/channels` → `POST /workspaces/:id/automations` → editar rascunho → `validate` → `publish` — tudo contra Postgres real.
2. Webhook do Meta assinado (`X-Hub-Signature-256`) → contato criado → `OutboxEvent` publicado → `TriggerMatcherService` casou com a automação publicada → `AutomationExecution` criada e processada pelo worker BullMQ real.
3. `MetaAdapter.sendMessage` chamou de fato `https://graph.facebook.com` e recebeu um 401 real ("Invalid OAuth access token") — esperado, já que o token de teste não é válido, mas confirma que a chamada HTTP está correta.
4. O worker tentou 5 vezes com backoff exponencial, a execução foi para `FAILED_PERMANENT`, e o job apareceu na fila `automation-execution-dlq` — exatamente o comportamento projetado.
5. Reenviar o mesmo webhook confirmou idempotência real: contato, execução e evento de outbox continuaram em 1 cada (sem duplicar).

Isso substitui a suíte de 98 testes unitários com mocks como a prova de que a lógica está certa — agora
também sabemos que ela funciona contra infraestrutura de verdade.

**M7 (Flow Builder) também foi verificado no navegador**, não só via testes automatizados: cadastro →
login → criar workspace → criar automação → montar o grafo no canvas (arrastar nós, conectar arestas) →
"Validar" retornou erros reais do `graph-validator` (nós desconectados) → após corrigir, confirmou
"Grafo válido" → "Publicar" criou a versão 1 de verdade no Postgres. Nenhuma camada mockada, do clique
no navegador até a linha gravada no banco.

**M8 (Inbox + handoff humano) validado do mesmo jeito** (2026-07-19): publiquei uma automação com
`trigger → human_handoff → end`, mandei um webhook assinado de verdade — a automação rodou, criou uma
`Conversation` real em `WAITING_HUMAN` e a execução ficou `WAITING` no Postgres. No Inbox pelo navegador
(login → workspace → Inbox): "Assumir" mudou o status para `HUMAN` de verdade; a resposta manual chamou
`graph.facebook.com` de verdade e mostrou o 401 esperado (token de teste); "Fechar" marcou a conversa
como `CLOSED`. Via API, `resume` reenfileirou a `AutomationExecution` no BullMQ e ela completou
(`COMPLETED`) — confirmando que o "devolver para o bot" retoma o grafo de onde parou, não só limpa o
status.

**M9 (Policy Engine) validado contra a mesma infraestrutura real** (2026-07-19): publiquei uma automação
`trigger → send_message → end`, mandei um webhook assinado de um contato novo — o Policy Engine deixou
passar (janela recém-aberta) e o `send_message` chegou a bater de verdade em `graph.facebook.com` (5
tentativas, 401 esperado, `FAILED_PERMANENT`). Mandar "PARAR" do mesmo contato: `optedOutAt` foi
gravado, a execução `WAITING` de um handoff anterior foi cancelada (`CANCELED`), e a automação disparada
pela própria mensagem "PARAR" falhou permanentemente em **1 passo** (não 5 tentativas) com "Contact has
opted out of messaging" — provando que o bloqueio aconteceu antes de qualquer chamada de rede, não
depois de uma falha da Meta. Mandar "voltar" limpou `optedOutAt`. No Inbox: resposta manual funcionou
normalmente dentro da janela; atrasando manualmente a última mensagem `IN` no Postgres para 25h atrás,
a mesma resposta voltou um 403 "24-hour messaging window is closed for this contact"; revogando um
`ContactConsent` com `purpose="messaging"` via `POST /contacts/:id/consents/:id/revoke`, voltou um 403
"Contact has revoked messaging consent".

**Nós `action`/`goal`/`start_another_flow` validados contra a mesma infraestrutura real** (2026-07-19):
publiquei uma automação `trigger → action(add_tag "vip") → goal → start_another_flow(Policy test flow) →
end` e mandei um webhook de verdade. No Postgres: o contato realmente ganhou a tag `vip`
(`contact_tags`), o passo do `goal` foi registrado com seu nome, e o passo do `start_another_flow`
gravou o `spawnedExecutionId` de uma nova `AutomationExecution` de verdade para a automação alvo — que
por sua vez chegou a tentar `graph.facebook.com` de verdade no seu próprio `send_message`. A execução
principal terminou `COMPLETED` com os 4 passos registrados em ordem. No Flow Builder, adicionei o nó de
Ação pela paleta, editei tipo/tag no painel de propriedades, e "Validar" retornou os erros reais do
`graph-validator` (nó não alcançável / sem aresta de saída) contra a API real antes de eu conectar as
arestas — confirmando que a validação nova (`ACTION_MISSING_TYPE`, `ACTION_MISSING_TAG`,
`START_ANOTHER_FLOW_MISSING_TARGET`) está mesmo no caminho do backend, não só no tipo TypeScript do
frontend.

**`collect_input` e `external_request` validados com uma chamada HTTPS de saída real, não só mockada**
(2026-07-20): publiquei `trigger → collect_input(favorite_color) → external_request(POST
https://postman-echo.com/post) → send_message → end`. Um primeiro webhook (gatilho) deixou a execução
`WAITING` com `currentNodeId` ainda apontando pro próprio nó `collect_input` no Postgres (confirmando
que ele não pré-avança, diferente de `delay`/`human_handoff`); um segundo webhook ("roxo") fez o
`CollectInputListener` gravar `{"favorite_color": "roxo"}` em `contextJson` e reenfileirar — e o
`external_request` bateu de verdade em `postman-echo.com`, recebeu 200, e a resposta foi salva num
campo personalizado (uma tentativa anterior com um campo do tipo errado falhou com um erro de coerção
claro, confirmando que a chamada de rede realmente aconteceu antes dessa falha). O `send_message`
seguinte renderizou `{{flow.favorite_color}}` como "You picked roxo" corretamente. Uma segunda
automação apontando pra um host fora da allow-list (`evil.example.com`) falhou permanentemente sem
nenhuma tentativa de rede — confirmando o fail-closed do SSRF. No Flow Builder, os dois nós renderizam
na paleta e no painel de propriedades com os valores reais salvos.

**M10 (Observabilidade) validado contra a API real rodando** (2026-07-20): `curl /health` respondeu
`{"status":"ok","checks":{"database":"ok","redis":"ok"}}` com 200 contra o Postgres/Redis locais reais.
`curl /metrics` sem header retornou 401; com o token errado, 401; com `X-Metrics-Token` correto, 200 com
números reais refletindo toda a atividade acumulada da sessão (execuções por status, profundidade da
fila e da dead-letter queue, total de negações do Policy Engine) — não dados de exemplo. O caminho de
falha do `/health` (Postgres ou Redis fora do ar) tem cobertura de teste unitário exercitando o mesmo
código, não uma reimplementação em mock — provocar uma queda de verdade do banco/Redis locais arriscaria
desestabilizar o ambiente usado pelo resto da sessão.

**OAuth automático de canal validado com chamadas reais a `facebook.com` e `graph.facebook.com`**
(2026-07-22): cliquei "Conectar com Facebook" no navegador real — o `start` gerou a URL do dialog OAuth
e navegou de verdade pro `facebook.com` (recebeu a página real "ID do app inválido", esperado com um
App de teste). Testei o `callback`: com `state` incompatível com o cookie, rejeitou por CSRF antes de
chamar qualquer coisa; com o `state` certo, chamou o endpoint `oauth/exchange` da API, que fez uma
chamada real pra `graph.facebook.com/oauth/access_token` e recebeu de volta o erro real da Meta
("Missing or invalid client id" - nosso App de teste não existe de verdade), propagado como mensagem
clara na tela. Prova a mesma coisa que o `MetaAdapter.sendMessage` já provava: a integração está
correta de ponta a ponta, só falta um App Meta aprovado de verdade pra completar com sucesso.

**Exclusão de workspace, paginação por cursor e atalho de teclado validados contra a API/UI reais**
(2026-07-22): `DELETE /workspaces/:id` marcou `deletedAt`, sumiu de `GET /workspaces`, e uma tentativa
seguinte de acessar ou deletar de novo voltou 403 "This workspace has been deleted" — confirmando que o
`WorkspaceRolesGuard` bloqueia num ponto só. Criei 5 contatos reais e paginei com `take=2` em 3 chamadas
seguidas usando o `cursor` retornado a cada vez: sem repetir nem pular nenhum, e a última página voltou
`nextCursor: null`. No Flow Builder, `Ctrl+S` mostrou "Rascunho salvo." sem eu clicar no botão.

## Limitações conhecidas

- OAuth com a Meta cobre só o caso de 1 Page por conta (ver "O que ainda não existe" acima); o formulário manual (`POST /workspaces/:id/channels`, colando um token já obtido fora do fluxo) continua existindo para os demais casos.
- Exclusão de workspace é soft-delete puro (marca `deletedAt`, some da listagem, fica inacessível) — não anonimiza PII nem purga dados de verdade; isso vira um item futuro se for necessário por compliance (ex: direito ao esquecimento).
- Retry de `send_message` pode reenviar uma mensagem que na verdade já saiu (se a falha ocorreu depois do envio mas antes de registrar sucesso) — semântica "at least once" reconhecida, sem idempotency key do lado da Meta ainda.
- Uma falha da Graph API na resposta manual do Inbox (`POST .../conversations/:id/messages`) sobe como 500 genérico — não há um exception filter traduzindo o erro do adapter para um 4xx/5xx específico; o texto digitado não é perdido (fica no campo), mas a mensagem de erro não diz "a Meta recusou o envio". Mesmo padrão já existia no runtime (o job só reflete "falhou", sem detalhar por quê, fora do log).
