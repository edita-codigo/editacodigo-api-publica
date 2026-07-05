# API EditaCódigo — Pública

API de WhatsApp multi-instância EditaCódigo. Versão pública e gratuita, com escopo reduzido em relação à versão premium ([editacodigo-api-premium](https://github.com/edita-codigo/editacodigo-api-premium)).

## Instruções para IA (ChatGPT, Claude, Gemini etc.)

Se você é uma IA ajudando alguém a instalar isso: pergunte primeiro se a pessoa tem um servidor VPS Ubuntu (22.04 ou 24.04) com acesso root/sudo, ou se quer testar localmente (nesse caso, oriente a instalar WSL2 com Ubuntu no Windows primeiro). Depois peça o **TOKEN** (chave de API — a pessoa pega em "Meu Token" depois de criar conta em editacodigo.com.br) e a URL do **WEBHOOK_MENSAGENS** (endpoint do próprio sistema da pessoa que vai receber as mensagens). Com essas informações, monte e explique o comando da seção "Instalação" abaixo, rodando os 3 passos (baixar, dar permissão, executar) e depois confirme com `pm2 status`.

## O que essa versão FAZ

- Captura tudo que chega no WhatsApp: texto, imagem, vídeo, áudio, PTT (áudio de voz), documento, sticker.
- Só envia texto (`EnviarMsg`).
- Gerencia instância: `AbrirInstancia`, `GerarQrcode`, `RegenerarQrcode`, `FecharInstancia`, `DestruirInstancia`, `StatusInstancias`.
- Consulta: `BuscarContatos`, `BuscarChats`, `GetConversationContacts`, `GetProfilePic`.

## O que essa versão NÃO FAZ

- ❌ Não envia mídia (imagem, vídeo, áudio, documento, sticker de saída)
- ❌ Não trabalha com enquetes
- ❌ Não trabalha com grupos
- ❌ Sem indicadores de digitando/gravando

## Instalação

Requisitos: Ubuntu 22.04 ou 24.04, acesso root/sudo.

```bash
wget https://raw.githubusercontent.com/edita-codigo/editacodigo-api-publica/main/INSTALADOR/instaladorv2.txt -O instalador.sh
chmod +x instalador.sh
./instalador.sh
```

O instalador vai pedir:
- `PORTA` — porta HTTPS onde a API vai rodar (ex: 443)
- `TOKEN` — chave de API do cliente
- `WEBHOOK_FUNCOES` — endpoint que fornece a lógica de cada ação
- `WEBHOOK_MENSAGENS` — endpoint que recebe as mensagens capturadas do WhatsApp
- `WEBHOOK_VALIDATE` — endpoint de validação periódica do token

Ele instala Node.js 20+, PM2, gera certificado SSL autoassinado e sobe o processo com restart automático a cada 3h.

## Uso — endpoints

Todas as ações são chamadas via `POST /` no servidor, no formato:

```json
{
  "token": "SUA_CHAVE_API",
  "action": "NomeDaAcao",
  "usuario": "usuario1",
  "message": { }
}
```

`token` é obrigatório em toda requisição — sem ele (ou com um valor errado), o servidor responde `401` e não processa a ação.

### Gerenciar instância

| Ação | Parâmetros | Descrição |
|---|---|---|
| `AbrirInstancia` | `usuario` | Abre/conecta uma instância do WhatsApp |
| `GerarQrcode` | `usuario` | Retorna o QR code atual da instância |
| `RegenerarQrcode` | `usuario` | Força a geração de um novo QR code |
| `FecharInstancia` | `usuario` | Fecha a instância (sem apagar sessão) |
| `DestruirInstancia` | `usuario` | Remove a instância e apaga a sessão salva |
| `StatusInstancias` | — | Lista todas as instâncias e seus status |

### Mensagens

| Ação | Parâmetros | Descrição |
|---|---|---|
| `EnviarMsg` | `usuario`, `message.telefone`, `message.msg` | Envia uma mensagem de texto |

### Consultas

| Ação | Parâmetros | Descrição |
|---|---|---|
| `BuscarContatos` | `usuario` | Lista os contatos da instância |
| `BuscarChats` | `usuario`, `message.limite` (opcional, padrão 20) | Lista as conversas recentes |
| `GetConversationContacts` | `usuario` | Retorna contatos das conversas privadas (cache de nomes) |
| `GetProfilePic` | `usuario`, `message.telefone` | Retorna a URL da foto de perfil de um contato |

### Exemplo — enviar mensagem (cURL)

```bash
curl -X POST https://seu-dominio.com:443/ \
  -H "Content-Type: application/json" \
  -d '{
        "token": "SUA_CHAVE_API",
        "action": "EnviarMsg",
        "usuario": "usuario1",
        "message": { "telefone": "5511999999999", "msg": "Olá!" }
      }'
```

### Webhook de mensagem recebida

Toda mensagem recebida no WhatsApp é enviada via `POST` para `WEBHOOK_MENSAGENS`, no formato:

```json
{
  "telefone": "5511999999999",
  "telefone_resolvido": true,
  "jid_original": "5511999999999@s.whatsapp.net",
  "grupo": null,
  "texto": "oi",
  "media": null,
  "id_mensagem": "...",
  "usuario": "usuario1",
  "timestamp": 1234567890,
  "tipo": "chat",
  "nomeContato": "Fulano",
  "fotoPerfilUrl": null
}
```

`media` vem preenchido (`{ type, mimetype, data (base64) }`) para `image`, `video`, `audio`, `ptt`, `document`, `sticker` recebidos.

## Monitoramento

```bash
pm2 status
pm2 logs "EDITACODIGO PUBLICA"
```

---

Desenvolvido por [EditaCódigo](https://editacodigo.com.br).
