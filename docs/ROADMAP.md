# Roadmap de marcos

Ordem de implementação (não pular etapas sem justificativa técnica registrada aqui).

| Marco | Escopo | Status |
|---|---|---|
| M0 | Monorepo, Docker Compose, Prisma, CI local | ✅ feito |
| M1 | Auth + Workspace + RBAC + Audit log | ✅ feito |
| M2 | Contatos + Tags + Campos personalizados + Consentimento | ✅ feito |
| M3 | Adapter Instagram/Messenger + webhook idempotente | ✅ feito |
| M4 | Eventos canônicos + outbox transacional | ✅ feito |
| M5 | Modelo de automação versionado + validador de grafo | ✅ feito |
| M6 | Runtime: trigger → mensagem → condição → fim, com fila/retry/idempotência/delay | ✅ feito |
| M7 | Flow Builder (React Flow) conectado às APIs reais | ✅ feito |
| M8 | Inbox + handoff humano | pendente |
| M9 | Policy Engine (janela de mensagem, consentimento, opt-out) | pendente |
| M10 | Observabilidade + métricas essenciais | pendente |

## Decisões registradas (ADR resumido)

- **Monólito modular, não microserviços** — evita complexidade operacional prematura; módulos NestJS já mapeiam para os domínios do documento mestre (Identity, Contacts, Channels, ...), o que permite extração futura se necessário.
- **RBAC como allow-list explícita por rota, sem hierarquia implícita de papéis** — Agent e Analyst têm permissões de natureza diferente de Builder, não um subconjunto; listar papéis explicitamente por rota evita bugs de "Owner esqueceu de herdar uma permissão nova".
- **Um único app Meta para todos os workspaces** — a assinatura do webhook (`X-Hub-Signature-256`) usa o App Secret da plataforma, não por conexão; o roteamento por workspace acontece depois, via `externalAccountId` (ID da página/conta IG), que é global e único por provider.
- **Conexão de canal manual neste marco** — o fluxo OAuth completo com a Meta (App Review, permissões, troca de código por token) é um projeto à parte; por ora a conexão aceita um token já obtido, para poder testar o adapter e o webhook de ponta a ponta sem depender de aprovação externa.
- **Outbox publicado por poller em memória (`setInterval`), não BullMQ** — Redis/BullMQ só entram no M6 junto da fila de execução do runtime; introduzir essa infra só para o outbox seria uma dependência operacional sem benefício neste marco. O poller processa em lotes de 20 a cada 2s, marca `processedAt` só após o `EventEmitter2.emitAsync` ter sucesso, e desiste (loga e marca como processado mesmo assim) depois de 5 tentativas para não travar a fila atrás de um evento "veneno".
- **`contact.message_received` é publicado dentro da mesma transação que cria/atualiza o contato** — antes (M3) a criação do contato e o `InboundEvent` já eram atômicos entre si; agora o `OutboxEvent` também entra nesse mesmo `$transaction` em `ChannelsService.ingestEvent`, então nunca existe um estado em que o contato foi criado mas o evento não foi publicado (ou vice-versa).
- **Grafo da automação como um único `Json` versionado, não `automation_nodes`/`automation_edges` normalizados** — a versão publicada precisa ser barata de carregar inteira para o runtime (M6); normalizar em tabelas adicionaria joins sem benefício até existir uma UI que edite nó a nó (M7). Migrar para tabelas é uma mudança isolada nessa camada depois, não um retrabalho do runtime.
- **Publicar sempre abre um novo draft (cópia) e nunca muta a versão publicada** — `AutomationsService.publish` marca a versão atual como `PUBLISHED` (arquivando a anterior) e imediatamente cria uma nova linha `DRAFT` com o mesmo grafo; edições subsequentes (`updateDraft`) só tocam essa nova linha, então uma versão publicada nunca muda depois que uma execução começou a rodar contra ela.
- **Cada job do BullMQ processa exatamente um nó do grafo, não a automação inteira** — `ExecutionRunnerService.runStep` executa um passo e decide se reenfileira (imediato ou com delay), pausa (`WAITING`) ou termina; isso torna o limite de passos, o registro por passo (`AutomationStepExecution`) e a semântica de retry triviais de raciocinar, ao custo de mais idas ao banco do que processar tudo numa única invocação.
- **Lógica de execução separada do adapter BullMQ** — `ExecutionRunnerService` não conhece BullMQ (testável sem Redis); `ExecutionProcessor` é só um adaptador fino que chama `runStep` e move o job para a dead-letter queue quando as tentativas se esgotam. `docker-compose.yml` já sobe Redis, mas o ambiente de desenvolvimento atual não conseguiu validar isso contra uma fila real (mesma limitação de sandbox do Postgres) — os 98 testes cobrem a lógica com Prisma/BullMQ mockados, não o comportamento real de fila.
- **`MetaAdapter.sendMessage` agora chama a Graph API de verdade** (`POST /{page-id}/messages` com `Authorization: Bearer`), mas nunca foi exercitado contra a API real da Meta — só testado com `fetch` mockado. Precisa de credenciais reais de um app Meta aprovado para validar de ponta a ponta.
- **`human_handoff` apenas pausa a execução (`WAITING`) neste marco** — não existe Conversation/Inbox ainda (chega no M8); a automação fica parada nesse nó até um marco futuro implementar a retomada.
- **M0-M6 validados de ponta a ponta contra infraestrutura real** (2026-07-17): Docker não sobe neste sandbox, mas um Postgres 14 e um Redis locais (via `initdb`/`redis-server` diretos, fora do `docker-compose.yml`) permitiram rodar a API de verdade e confirmar signup → workspace → canal → automação publicada → webhook assinado → outbox → execução → tentativa real contra a Graph API da Meta (retornou 401 esperado, já que o token de teste não é real) → 5 tentativas com backoff → `FAILED_PERMANENT` → job na dead-letter queue. Replay do mesmo webhook confirmou zero duplicação (contato, execução e outbox ficaram em 1 cada). Isso fecha a lacuna de validação que vinha sendo carregada desde o primeiro marco.
- **M7 (Flow Builder) também validado no navegador contra a API real, não só com testes automatizados** (2026-07-17): fluxo completo via browser — signup → criar workspace → criar automação → montar o grafo arrastando nós (gatilho, mensagem, fim) e conectando arestas no canvas React Flow → "Validar" retornou erros reais do `graph-validator` (nós desconectados) → após conectar corretamente, "Validar" confirmou "Grafo válido" → "Publicar" criou a versão 1 no Postgres real. Nenhum mock em nenhuma camada (frontend → proxy Next.js → API NestJS → Postgres).
- **Autenticação do frontend via cookie httpOnly, nunca localStorage** — `POST /api/auth/login` do Next.js troca credenciais pela API e grava o JWT num cookie `mz_token` httpOnly; todo fetch autenticado do lado do cliente passa por `/api/proxy/[...path]`, que lê o cookie no servidor e injeta o header `Authorization` — o token nunca fica acessível a JS no browser.
- **Deploy dividido: API no Render, frontend na Vercel** — a API precisa ficar sempre ligada (o worker BullMQ processa a fila continuamente, inclusive nós de espera agendados), o que não cabe no modelo serverless da Vercel; o frontend Next.js, por ser request-driven, roda bem na Vercel, que tem suporte nativo melhor que o Render pra isso. `render.yaml` cobre só a API; os passos da Vercel estão documentados no README.
