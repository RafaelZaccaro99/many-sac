# Many Zac

Plataforma SaaS de automação conversacional omnichannel (marketing, atendimento e vendas).
Monólito modular: API em NestJS + PostgreSQL + Redis. Ver `docs/ROADMAP.md` para o plano de marcos.

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

- Postgres: [neon.tech](https://neon.tech) (tier gratuito permanente) — copie a `DATABASE_URL`.
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
   | `DATABASE_URL` | a do Neon |
   | `REDIS_URL` | a do Upstash |
   | `JWT_SECRET` | gere com `openssl rand -base64 48` |
   | `CREDENTIALS_ENCRYPTION_KEY` | gere com `openssl rand -base64 32` |
   | `META_APP_SECRET` | do seu App em developers.facebook.com |
   | `META_WEBHOOK_VERIFY_TOKEN` | qualquer string aleatória sua, ex: `openssl rand -hex 16` |

3. Deploy dispara sozinho. O `startCommand` já roda `prisma migrate deploy` antes de subir, então as
   tabelas são criadas automaticamente no Neon no primeiro deploy.
4. Anote a URL pública que o Render deu (ex: `https://many-zac-api.onrender.com`).

### 4. Frontend na Vercel

1. **Add New → Project**, aponte para o mesmo repositório.
2. Em **Root Directory**, selecione `apps/web` (é um monorepo com npm workspaces — a Vercel detecta o
   Next.js sozinha a partir daí).
3. Em **Environment Variables**, adicione `API_URL` = a URL do Render do passo anterior.
4. Deploy. Anote a URL que a Vercel deu (ex: `https://many-zac.vercel.app`).

### 5. Webhook real na Meta

No painel da Meta (developers.facebook.com → seu App → Webhooks), assine `messages` para
Instagram/Messenger apontando para `https://<sua-api>.onrender.com/webhooks/meta`, usando o mesmo
`META_WEBHOOK_VERIFY_TOKEN` do passo 3.

### 6. Conectar e testar

Acesse a URL da Vercel, crie sua conta, workspace, e em **Canais** cole o ID da sua Page/conta do
Instagram e o access token real (gerado no painel da Meta). Publique uma automação com um gatilho e um
nó de mensagem, mande uma DM de verdade para a conta conectada (de uma conta cadastrada como tester no
seu App, se ele ainda estiver em modo desenvolvimento) e veja a resposta chegar de verdade.

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

## O que já funciona (M0-M7)

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
- Deploy pronto para produção via [render.yaml](render.yaml) (ver seção Deploy abaixo) — necessário para testar com um número/conta real, já que a Meta não chama `localhost`

## O que ainda não existe (não alegar pronto)

- Inbox, Policy Engine (M8-M9)
- `human_handoff` só pausa a execução (`WAITING`); não existe Conversation/Inbox para retomá-la ainda (chega no M8)
- Nós `action`, `collect_input`, `start_another_flow`, `external_request` e `goal` são rejeitados pelo runtime como "não suportado ainda" — só `trigger`/`send_message`/`condition`/`delay`/`end`/`human_handoff` funcionam, e o Flow Builder só oferece esses na paleta
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

## Limitações conhecidas

- Sem OAuth real com a Meta: conexão de canal é manual (`POST /workspaces/:id/channels`), recebendo um token que você já obteve fora do fluxo. Isso é aceitável para provar o adapter e o webhook, mas não é o fluxo de conexão final.
- Sem exclusão de workspace (ação exclusiva do Owner) — deliberadamente fora de escopo por ser uma operação destrutiva; entra num marco dedicado com soft-delete/anonimização.
- Sem paginação por cursor em `GET /contacts` (usa offset/limit) — trocar antes de ter volume real de contatos.
- Retry de `send_message` pode reenviar uma mensagem que na verdade já saiu (se a falha ocorreu depois do envio mas antes de registrar sucesso) — semântica "at least once" reconhecida, sem idempotency key do lado da Meta ainda.
