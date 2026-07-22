# Próximos passos

Documento vivo — atualize/apague itens conforme forem resolvidos. Objetivo: qualquer sessão futura
(sua ou de um agente) consegue retomar o trabalho lendo só este arquivo, sem precisar reconstruir
contexto a partir da conversa anterior.

**Última atualização:** 2026-07-22. Plano técnico completo (Fases C/D/E/F) feito. **Fase A também está
feita: a API está no ar de verdade em produção** (`https://many-zac-api.onrender.com`), com Postgres
(Supabase) e Redis (Upstash) reais - `/health` confirma os dois, e um signup/workspace real de teste
funcionou via HTTPS pública. Só resta a **Fase B** (App Meta real + deploy do frontend na Vercel).

**Nota operacional 1**: o Postgres local (porta 5433) parou de existir entre sessões (o diretório de
dados anterior sumiu - provavelmente estava em `/tmp` ou similar). Recriei em `~/.many-zac/pgdata`
(persistente, fora de qualquer diretório temporário), iniciado com
`pg_ctl -D ~/.many-zac/pgdata -o "-p 5433" -l ~/.many-zac/pg.log start`. Se `curl localhost:3001/health`
disser Redis/Postgres down, comece checando se esse processo ainda está de pé
(`pg_isready -h localhost -p 5433`) antes de qualquer outra coisa.

**Nota operacional 2**: agora tenho acesso de API ao Render e ao Supabase (chaves salvas em
`~/.many-zac/render-api-key` e `~/.many-zac/supabase-management-token`, fora do repo, `chmod 600`) -
consigo configurar env vars, disparar deploys e ler logs do Render, e consultar config do projeto
Supabase, sem precisar que o usuário clique em nada. Exemplos de uso na seção 2 abaixo. Essas chaves
foram compartilhadas em texto puro no chat em algum momento - o usuário pode revogar/regenerar a
qualquer momento nos respectivos painéis (Render → Account Settings → API Keys; Supabase →
Account → Access Tokens) se preferir não deixá-las de pé.

## Estado atual em uma frase

O produto funciona de ponta a ponta contra Postgres/Redis/BullMQ reais **e agora também está de pé em
produção de verdade** (Render + Supabase + Upstash) - `/health` e um signup/workspace reais confirmaram
isso via HTTPS pública, não só localhost. M0 a M10 do `docs/ROADMAP.md` estão todos feitos, todo o plano
técnico que eu conseguia fazer sozinho está feito, e a Fase A (infra gerenciada) também está feita. Só
falta a Fase B: criar o App real na Meta e subir o frontend na Vercel.

---

## 1. Push para o GitHub: resolvido de forma permanente (2026-07-22)

Este repositório agora tem uma **deploy key SSH dedicada** (só para este repo, com escrita habilitada),
configurada em `git config core.sshCommand` (local a este repo, não afeta SSH em nenhum outro lugar da
sua máquina). Isso significa que **eu consigo dar `git push` sozinho** a partir de agora, sem depender
de você rodar o push manualmente.

Detalhes técnicos, caso precise recriar isso numa máquina nova:
- Chave privada: `~/.ssh/id_ed25519_manyzac` (sem senha, só usada por este repo)
- Configurado via `git config core.sshCommand "ssh -i ~/.ssh/id_ed25519_manyzac -o IdentitiesOnly=yes"`
- Remote trocado de HTTPS para SSH: `git@github.com:RafaelZaccaro99/many-sac.git`
- Chave pública adicionada em https://github.com/RafaelZaccaro99/many-sac/settings/keys como Deploy Key
  com "Allow write access" marcado

Se por algum motivo o push voltar a falhar (ex: ambiente novo, chave revogada), o sintoma será algo como
`Permission denied (publickey)` ou (se o remote voltar a ser HTTPS) `could not read Username for
'https://github.com'`. Nesse caso, repita o processo: gerar uma chave nova, pedir pro usuário adicionar
como Deploy Key no repo, reconfigurar `core.sshCommand` e o remote.

---

## 2. Fase A: ✅ feita (2026-07-22) — infraestrutura gerenciada real

- **Postgres**: Supabase, projeto `unplzzkifgdjunfktvfj` (ref), região `ca-central-1`. **Importante**:
  usamos o **Session pooler** (`aws-0-ca-central-1.pooler.supabase.com:5432`, usuário
  `postgres.unplzzkifgdjunfktvfj`), **não** a conexão direta (`db.<projeto>.supabase.co`) - essa hoje só
  resolve por IPv6 e o Render não tem saída IPv6, então falha com `P1001: Can't reach database server`.
  Isso corrige a orientação anterior deste documento (que recomendava a conexão direta) - ver README,
  seção Deploy, para o texto atualizado.
- **Redis**: Upstash, `rediss://` (TLS), testado com `redis-cli --tls -u "..." ping` → `PONG`.
- **API no Render**: serviço `many-zac-api` (`srv-d9d958l7vvec73euu1d0`) já existia de uma sessão
  anterior, mas estava com as env vars secretas vazias (por isso os últimos deploys falhavam,
  inclusive um que não mudava nenhum código). Configurei as 10 variáveis via API do Render e disparei
  o deploy - **está no ar**: `curl https://many-zac-api.onrender.com/health` → `{"status":"ok",
  "checks":{"database":"ok","redis":"ok"}}`. Testei signup + criação de workspace reais via HTTPS
  pública, e deletei o workspace de teste depois (soft-delete).

### Como eu tenho acesso de API agora (pra uma próxima sessão)

- **Render**: `~/.many-zac/render-api-key` (fora do repo). Uso: `curl -H "Authorization: Bearer $(cat
  ~/.many-zac/render-api-key)" https://api.render.com/v1/services/srv-d9d958l7vvec73euu1d0/...` -
  consigo listar/editar env vars (`GET`/`PUT .../env-vars`), disparar deploy (`POST .../deploys`), ler
  logs (`GET /v1/logs?ownerId=tea-d9d90evaqgkc7382np4g&resource=srv-d9d958l7vvec73euu1d0`).
- **Supabase**: `~/.many-zac/supabase-management-token`. Uso: `curl -H "Authorization: Bearer $(cat
  ~/.many-zac/supabase-management-token)" https://api.supabase.com/v1/projects` - útil pra confirmar
  region/host do pooler sem o usuário precisar navegar no painel.
- Ambas as chaves foram compartilhadas em texto puro no chat em algum momento da sessão - o usuário
  pode revogar/regenerar quando quiser (Render → Account Settings → API Keys; Supabase → Account →
  Access Tokens), não afeta nada além de eu precisar de uma chave nova.

---

## 3. Fase B: pendente — só o usuário pode fazer

1. **Frontend na Vercel**: Add New → Project apontando pro repo `RafaelZaccaro99/many-sac`,
   **Root Directory** = `apps/web`. Variáveis: `API_URL` = `https://many-zac-api.onrender.com`;
   `APP_URL` = a URL que a própria Vercel vai dar; `META_APP_ID` (do passo 2 abaixo).
2. **App Meta real** (developers.facebook.com): criar o App (tipo Business) + produto "Facebook
   Login", pegar `META_APP_ID`/`META_APP_SECRET`, registrar a Valid OAuth Redirect URI exata
   (`https://<vercel>/api/oauth/meta/callback`), adicionar a própria conta como tester.
3. Atualizar no Render (eu faço, só preciso do valor real): `META_APP_SECRET` está com um placeholder
   (`"placeholder-until-meta-app-created"`) - trocar pelo valor real assim que o App existir.
4. **Assinar o webhook**: painel do App Meta → Webhooks → assinar `messages` apontando para
   `https://many-zac-api.onrender.com/webhooks/meta`, usando o `META_WEBHOOK_VERIFY_TOKEN` já
   configurado no Render.
5. **Testar de verdade**: acessar a URL da Vercel, criar conta, workspace, e em "Canais" clicar
   "Conectar com Facebook" (funciona sozinho se a conta tiver 1 Page só). Publicar uma automação
   simples, mandar uma DM de uma conta cadastrada como tester do App e confirmar a resposta chegando.

---

## 4. Plano técnico de código (todo feito - Fases C/D/E/F)

### Fase C — OAuth automático de canal: ✅ feito (2026-07-22)
Botão "Conectar com Facebook" (`apps/api/src/channels/meta-oauth.service.ts` +
`apps/web/src/app/api/oauth/meta/`). Escopo deliberadamente reduzido: só conecta automaticamente quando
a conta tem **exatamente 1 Page**; mais de uma cai de volta pro formulário manual (sem cache de estado
pendente nem tela de escolha de Page - decisão de simplicidade, não uma limitação técnica). Validado com
chamadas reais a `facebook.com`/`graph.facebook.com` - ver `docs/ROADMAP.md`.

### Fase D — Exclusão de workspace (soft-delete): ✅ feito (2026-07-22)
`Workspace.deletedAt` + `WorkspacesService.softDelete` (só Owner, audit log) + `listForUser` filtrando
`deletedAt: null` + `WorkspaceRolesGuard` rejeitando qualquer rota de um workspace deletado (ponto único,
não duplicado por controller). `DELETE /workspaces/:id`. Anonimização de PII fica de fora (é soft-delete
reversível, não "direito ao esquecimento"). Validado contra a API real - ver `docs/ROADMAP.md`.

### Fase E — Paginação por cursor em `GET /contacts`: ✅ feito (2026-07-22)
`ContactsService.list`/`ContactsController.list` trocaram `skip` por `cursor` (id do último item),
retornando `{items, nextCursor}`. Validado com 5 contatos reais paginados em 3 chamadas sem repetir nem
pular linha. Sem UI pra atualizar (não existe tela de contatos no frontend ainda).

### Fase F — Atalho de teclado no Flow Builder: ✅ feito (2026-07-22)
`Cmd/Ctrl+S` chama `saveDraft()`. Confirmado no navegador real: "Rascunho salvo." apareceu sem clicar em
nenhum botão. Auto-organizar layout ficou fora (cosmético, não bloqueia uso).

### Lacunas que continuam fora de escopo (documentadas, não construídas)
- Idempotency key no `send_message` ("at least once", pode reenviar uma mensagem que já saiu).
- `TriggerMatcherService` não olha o status da conversa antes de abrir uma nova execução.
- `start_another_flow` só bloqueia o auto-loop direto, não um ciclo indireto A→B→A.
- `EXTERNAL_REQUEST_ALLOWED_HOSTS` é global por deploy, não por workspace, e não protege contra DNS
  rebinding.
- Exception filter global pra traduzir falhas do `MetaAdapter` em 4xx/5xx específicos no Inbox.
- OAuth automático só cobre 1 Page por conta (ver Fase C).

---

## 5. Checklist pra retomar numa próxima sessão

Se você (ou um agente) está lendo isto pra continuar o trabalho, nessa ordem:

1. `git log origin/main -1` e compare com o `git log -1` local — confirme que estão sincronizados (o
   push agora é automático via deploy key, mas confira mesmo assim se algo mudou fora desta sessão).
2. Confirme que o Postgres local está de pé (`pg_isready -h localhost -p 5433`) antes de rodar
   qualquer coisa - ver a nota operacional no topo deste documento se não estiver.
3. Rode `npm run test:api` na raiz — deve dar 188/188 (ou mais, se novas fases já entraram). Se não
   bater, algo mudou fora desta sessão; investigue antes de continuar.
4. Todo o plano técnico (Fases C/D/E/F) está feito - só resta a seção 2 (Fase A/B, contas externas).
   Se o usuário pedir algo novo de código, siga o mesmo padrão já estabelecido no projeto: implementar, escrever
   teste, validar contra Postgres/Redis reais (não só mock), atualizar `README.md` e `docs/ROADMAP.md`
   no mesmo commit/sessão. Não deixe a documentação dessincronizar do código.
