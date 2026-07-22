# Próximos passos

Documento vivo — atualize/apague itens conforme forem resolvidos. Objetivo: qualquer sessão futura
(sua ou de um agente) consegue retomar o trabalho lendo só este arquivo, sem precisar reconstruir
contexto a partir da conversa anterior.

**Última atualização:** 2026-07-22. Plano técnico completo: Fases C (OAuth automático), D (soft-delete
de workspace), E (paginação por cursor) e F (atalho de teclado) todas implementadas, testadas e
validadas contra API/Postgres/UI reais nesta sessão. Push funciona sozinho (seção 1). **Só restam as
Fases A e B, que só você pode fazer** (contas externas) — ver seção 2.

**Nota operacional**: o Postgres local (porta 5433) parou de existir entre sessões (o diretório de dados
anterior sumiu - provavelmente estava em `/tmp` ou similar). Recriei em `~/.many-zac/pgdata` (persistente,
fora de qualquer diretório temporário), iniciado com
`pg_ctl -D ~/.many-zac/pgdata -o "-p 5433" -l ~/.many-zac/pg.log start`. Se `curl localhost:3001/health`
disser Redis/Postgres down, comece checando se esse processo ainda está de pé
(`pg_isready -h localhost -p 5433`) antes de qualquer outra coisa.

## Estado atual em uma frase

O produto funciona de ponta a ponta contra Postgres/Redis/BullMQ reais (validado, não só testado com
mock), incluindo uma chamada HTTPS de saída real, um `/health`/`/metrics` reais, um fluxo OAuth real de
conexão de canal, exclusão de workspace, paginação por cursor e atalho de teclado no Flow Builder — M0 a
M10 do `docs/ROADMAP.md` estão todos feitos, e todo o plano técnico que eu conseguia fazer sozinho está
feito. O que falta agora é 100% aquisição de conta/infraestrutura (Fases A/B) - não tem mais nenhum item
de código pendente que eu possa resolver sem depender de você.

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

## 2. O que só você pode fazer (nenhuma dessas eu consigo fazer sozinho)

Nenhuma delas é código — são contas/credenciais externas que exigem seu login em painéis de terceiros.
Chamo estas de **Fase A** (infra) e **Fase B** (Meta) no plano técnico abaixo.

1. ~~Push do commit~~ — resolvido (seção 1 acima), eu cuido disso sozinho agora.
2. **Fase A - Banco Postgres gerenciado**: [neon.tech](https://neon.tech) ou
   [supabase.com](https://supabase.com) (tier gratuito permanente). Copie a `DATABASE_URL`. No Supabase
   use a conexão **direta** (porta `5432`), não o pooler da `6543` (ver README, seção Deploy).
3. **Fase A - Redis gerenciado**: [upstash.com](https://upstash.com) (tier gratuito). Copie a
   `REDIS_URL` na variante `rediss://` (com TLS). Me passe as duas strings (não persisto em lugar
   nenhum do repo) e eu confirmo `prisma migrate deploy` + conectividade antes de você mexer no Render.
4. **Serviço da API no Render**: New → Blueprint apontando pro repo — ele lê `render.yaml` sozinho e
   cria o serviço `many-zac-api`. Preencha no painel (nunca vão pro git):
   - `DATABASE_URL` (do passo 2) / `REDIS_URL` (do passo 3)
   - `JWT_SECRET` → `openssl rand -base64 48` / `CREDENTIALS_ENCRYPTION_KEY` → `openssl rand -base64 32`
   - `META_APP_SECRET` (Fase B) / `META_WEBHOOK_VERIFY_TOKEN` → `openssl rand -hex 16`
   - `EXTERNAL_REQUEST_ALLOWED_HOSTS` → vazio bloqueia todo nó `external_request`; liste os hosts que
     suas automações podem chamar, separados por vírgula, só quando precisar dessa feature
   - `METRICS_TOKEN` → `openssl rand -hex 16`; sem isso `GET /metrics` fica inacessível (falha fechado)
   - Se o serviço **já existir** de uma sessão anterior, só confirme que essas variáveis estão
     preenchidas e que o deploy mais recente ficou verde.
5. **Frontend na Vercel**: Add New → Project no mesmo repo, **Root Directory** = `apps/web`. Variáveis:
   `API_URL` = URL pública do Render (passo 4); `APP_URL` = a própria URL que a Vercel vai te dar;
   `META_APP_ID` = ID público do seu App (Fase B).
6. **Fase B - App Meta real** (developers.facebook.com): criar o App (tipo Business) + produto
   "Facebook Login", pegar `META_APP_ID`/`META_APP_SECRET`, registrar a Valid OAuth Redirect URI exata
   (`https://<vercel>/api/oauth/meta/callback`), adicionar sua conta como tester.
7. **Assinar o webhook**: no painel do App Meta → Webhooks → assinar `messages` apontando para
   `https://<sua-api>.onrender.com/webhooks/meta`, usando o mesmo `META_WEBHOOK_VERIFY_TOKEN` do
   passo 4.
8. **Testar de verdade**: acessar a URL da Vercel, criar conta, workspace, e em "Canais" clicar
   "Conectar com Facebook" (funciona sozinho se a conta tiver 1 Page só; mais de uma ainda usa o
   formulário manual). Publicar uma automação simples, mandar uma DM de uma conta cadastrada como
   tester do App e confirmar a resposta chegando.

Depois de qualquer um desses passos, me diga a URL pública da API (ex: `https://many-zac-api.onrender.com`)
e eu confirmo o health check e ajudo a debugar qualquer erro de deploy/env var que aparecer nos logs do
Render — isso eu consigo fazer via `curl`/leitura de logs, só não consigo entrar no painel.

---

## 3. Plano técnico do que falta (não depende de credenciais externas — posso fazer em uma próxima sessão)

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

## 4. Checklist pra retomar numa próxima sessão

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
