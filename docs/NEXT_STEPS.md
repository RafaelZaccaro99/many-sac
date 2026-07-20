# Próximos passos

Documento vivo — atualize/apague itens conforme forem resolvidos. Objetivo: qualquer sessão futura
(sua ou de um agente) consegue retomar o trabalho lendo só este arquivo, sem precisar reconstruir
contexto a partir da conversa anterior.

**Última atualização:** 2026-07-20, depois de M8 (Inbox) + M9 (Policy Engine) + **todos os 11 tipos de
nó do runtime** implementados (`action`/`goal`/`start_another_flow`/`collect_input`/`external_request`).
Commit `6e152f3` já confirmado no GitHub (push feito entre sessões); o trabalho de `collect_input`/
`external_request` desta sessão ainda está **local, não commitado** — ver seção 0.

## Estado atual em uma frase

O produto funciona de ponta a ponta contra Postgres/Redis/BullMQ reais (validado, não só testado com
mock), incluindo uma chamada HTTPS de saída real (`external_request` contra `postman-echo.com`) — M0 a
M9 do `docs/ROADMAP.md` estão feitos, e não existe mais nenhum tipo de nó "aceito no Flow Builder mas
rejeitado em produção". O que falta é (1) colocar isso no ar com uma conta Meta real e (2) fechar as
lacunas menores já documentadas no README (M10, paginação, idempotency key, etc.).

---

## 0. Ação pendente desta sessão: commitar collect_input/external_request

Ainda não commitei o trabalho desta sessão (`collect_input`, `external_request`, o namespace `flow.*`
de variáveis, e as correções no Flow Builder). Se você está lendo isto e não pediu explicitamente pra
eu commitar antes de parar, rode:

```bash
cd "/Users/rafaelzaccaro/MANY ZAC"
git status --short   # confira o que está pendente antes de decidir
git add -A            # ou liste os arquivos manualmente
git commit -m "Add collect_input and external_request runtime nodes"
git push origin main  # eu não consigo fazer isso - ver seção 1
```

Ou simplesmente peça "commite e dê push" na próxima sessão - eu comito, e o push você confirma como já
fez da última vez (seção 1 explica por quê).

---

## 1. Por que eu não consigo dar `git push` sozinho

Este ambiente de sessão não tem nenhuma credencial do GitHub configurada (nem token HTTPS salvo no
keychain, nem chave SSH) - toda tentativa de `git push` falha com:

```
fatal: could not read Username for 'https://github.com': Device not configured
```

Da última vez isso foi resolvido rodando `git push origin main` de um terminal seu onde o GitHub já
funciona. Se quiser que eu não dependa disso toda sessão, veja a seção **"Se quiser me dar acesso de
push"** no final deste documento.

---

## 2. O que só você pode fazer (nenhuma dessas eu consigo fazer sozinho)

Nenhuma delas é código — são contas/credenciais externas que exigem seu login em painéis de terceiros.
Ordem sugerida:

1. **Push do commit** (seção 1 acima) — sem isso nada do resto se move.
2. **Banco Postgres gerenciado**: [neon.tech](https://neon.tech) ou [supabase.com](https://supabase.com)
   (tier gratuito permanente). Copie a `DATABASE_URL`. No Supabase use a conexão **direta** (porta
   `5432`), não o pooler da `6543` (ver README, seção Deploy, pra entender por quê).
3. **Redis gerenciado**: [upstash.com](https://upstash.com) (tier gratuito). Copie a `REDIS_URL` na
   variante `rediss://` (com TLS).
4. **Serviço da API no Render**: New → Blueprint apontando pro repo — ele lê `render.yaml` sozinho e
   cria o serviço `many-zac-api`. Preencha no painel (nunca vão pro git):
   - `DATABASE_URL` (do passo 2)
   - `REDIS_URL` (do passo 3)
   - `JWT_SECRET` → `openssl rand -base64 48`
   - `CREDENTIALS_ENCRYPTION_KEY` → `openssl rand -base64 32`
   - `META_APP_SECRET` (passo 6)
   - `META_WEBHOOK_VERIFY_TOKEN` → qualquer string aleatória, ex: `openssl rand -hex 16`
   - Se o serviço **já existir** de uma sessão anterior (os commits de "fix Render build" sugerem que
     sim), só confirme que essas variáveis estão preenchidas e que o deploy mais recente ficou verde.
5. **Frontend na Vercel**: Add New → Project no mesmo repo, **Root Directory** = `apps/web`. Variável
   de ambiente `API_URL` = URL pública do Render (passo 4).
6. **App Meta real** (developers.facebook.com): criar o App, pegar `META_APP_ID`/`META_APP_SECRET`,
   conectar uma Page/conta Instagram, gerar um access token de verdade. Sem isso, todo envio de
   mensagem continua batendo um 401 real (é o que estamos vendo até agora — a chamada HTTP está
   correta, só o token é de teste).
7. **Assinar o webhook**: no painel do App Meta → Webhooks → assinar `messages` apontando para
   `https://<sua-api>.onrender.com/webhooks/meta`, usando o mesmo `META_WEBHOOK_VERIFY_TOKEN` do
   passo 4.
8. **Testar de verdade**: acessar a URL da Vercel, criar conta, workspace, colar o ID da Page + o
   access token real em "Canais", publicar uma automação simples, mandar uma DM de uma conta cadastrada
   como tester do App (se ele ainda estiver em modo desenvolvimento) e confirmar a resposta chegando.

Depois de qualquer um desses passos, me diga a URL pública da API (ex: `https://many-zac-api.onrender.com`)
e eu confirmo o health check e ajudo a debugar qualquer erro de deploy/env var que aparecer nos logs do
Render — isso eu consigo fazer via `curl`/leitura de logs, só não consigo entrar no painel.

---

## 3. Plano técnico do que falta (não depende de credenciais externas — posso fazer em uma próxima sessão)

Ordem sugerida, da mais isolada pra mais dependente:

### Fase 5 — Nós de runtime restantes: ✅ feito (2026-07-20)
Todos os 11 tipos de nó (`trigger`, `send_message`, `condition`, `delay`, `end`, `human_handoff`,
`action`, `goal`, `start_another_flow`, `collect_input`, `external_request`) têm handler no runtime,
regra no `graph-validator.ts`, e paleta + painel de propriedades no Flow Builder. Validado contra
Postgres/Redis reais e uma chamada HTTPS de saída de verdade (`postman-echo.com`) - ver
`docs/ROADMAP.md` pros detalhes. Único item que sobrou: `start_another_flow` só bloqueia o auto-loop
direto, não um ciclo indireto A→B→A (ver Fase 7).

### Fase 6 — M10: Observabilidade
- `/health` de verdade (Render já aponta `healthCheckPath: /health` no `render.yaml`, mas o handler
  atual é mínimo — confirmar se cobre Postgres/Redis/fila ou só "processo de pé").
- Logs estruturados (JSON) em produção.
- Métricas essenciais: taxa de `FAILED_PERMANENT`/DLQ, profundidade da fila BullMQ, latência de
  processamento de webhook, taxa de bloqueios do Policy Engine.

### Fase 7 — Lacunas menores (qualquer ordem, sem dependência forte entre si)
- Paginação por cursor em `GET /contacts` (hoje é offset/limit).
- Idempotency key no `send_message` (hoje é "at least once" — pode reenviar uma mensagem que já saiu
  se a falha ocorrer entre o envio e o registro de sucesso).
- Exclusão de workspace com soft-delete/anonimização (ação exclusiva do Owner).
- `TriggerMatcherService` ainda não olha o status da conversa antes de abrir uma nova execução — uma
  automação pode ser re-disparada por uma mensagem enquanto o contato já está em atendimento humano.
- `start_another_flow` só bloqueia o auto-loop direto (automação apontando pra si mesma); um ciclo
  indireto A→B→A não é detectado.
- Exception filter global pra traduzir falhas do `MetaAdapter` (Graph API) em 4xx/5xx específicos na
  resposta manual do Inbox, em vez do 500 genérico atual.
- Flow Builder: sem posicionamento automático de nós nem atalhos de teclado (funcional, não polido).

### Fase 8 — OAuth real com a Meta (projeto à parte)
Depende de App Review da Meta (processo externo, não é só código) — deliberadamente fora do escopo das
fases acima. Hoje a conexão de canal aceita um token já obtido manualmente, o que é suficiente pra
provar o adapter/webhook mas não é o fluxo de conexão final para um cliente real usar sozinho.

---

## 4. Checklist pra retomar numa próxima sessão

Se você (ou um agente) está lendo isto pra continuar o trabalho, nessa ordem:

1. `git log origin/main -1` e compare com o `git log -1` local — confirme se há commits locais ainda
   não empurrados (ver seção 0/1 acima).
2. Rode `npm run test:api` na raiz — deve dar 152/152 (ou mais, se novas fases já entraram). Se não
   bater, algo mudou fora desta sessão; investigue antes de continuar.
3. Decida: seguir pra seção 2 (deploy) ou seção 3 (fases técnicas)? Pergunte ao usuário se não estiver
   claro — as duas frentes são independentes uma da outra.
4. Se for continuar a Fase 6/7/8: siga o mesmo padrão já estabelecido no projeto — implementar,
   escrever teste, validar contra Postgres/Redis reais (não só mock), atualizar `README.md` e
   `docs/ROADMAP.md` no mesmo commit/sessão. Não deixe a documentação dessincronizar do código.

---

## Se quiser me dar acesso de push

Pra eu não depender de você rodar `git push` manualmente toda sessão, existem duas opções — nenhuma
delas eu posso configurar sozinho por segurança (envolve credenciais), mas documento aqui pra você
decidir:

- **Personal Access Token do GitHub** com escopo `repo`, exportado como variável de ambiente
  (`GIT_ASKPASS` ou credential helper) no ambiente onde as sessões rodam. Eu nunca veria o token em
  texto puro na conversa, só o usaria via o mecanismo de credencial do git.
- **`gh auth login`** rodado por você uma vez neste ambiente, se ele persistir entre sessões.

Isso é opcional — o fluxo atual (eu committo, você dá push) funciona, só tem uma etapa manual a mais.
