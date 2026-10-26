# Deploy na Vercel

O front-end é uma SPA Vite estática. O operador não faz parte deste deploy: ele deve rodar em um servidor separado e as suas chaves nunca podem ser cadastradas na Vercel.

## Criar o projeto

1. Importe o repositório no painel da Vercel.
2. Em **Root Directory**, escolha `web`.
3. Em **Build and Output Settings**, use:
   - Install Command: `corepack enable && (cd ../sdk && pnpm install --no-frozen-lockfile --prod=false) && pnpm install --no-frozen-lockfile --prod=false`
   - Build Command: `pnpm build`
   - Output Directory: `app/dist`
4. Em **Node.js Version**, selecione `22.x`.
5. Não cadastre `CMI_OPERATOR_SPENDER_KEY`, `CMI_REGISTER_DATA` ou `VITE_DEV_WALLET=1` nas variáveis de produção.
6. Faça o deploy.

`vercel.json` redireciona rotas que pertencem ao React Router, por exemplo `/market/1` e `/company`, para `index.html`. Sem isso, abrir essas URLs diretamente retornaria 404.

O front e o SDK têm workspaces e lockfiles separados. O comando de instalação prepara ambos para disponibilizar os tipos e as dependências usados pelo build.

## Antes de publicar

- O deploy atual aponta para Stellar **Testnet** pelo arquivo público `app/public/config/testnet.json`.
- Confirme que o `registerData` desse arquivo foi gerado pelo operador que estará ativo. Esse dado é público; chaves do operador não são.
- Depois do primeiro deploy, adicione o domínio da Vercel à variável `CMI_CORS_ORIGINS` do operador, quando ele for publicado.
