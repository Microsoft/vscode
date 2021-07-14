# Web Standalone

Static site build to deploy netlify, firebase.

## How to develop

```bash
# on repository root
yarn install
yarn compile
yarn watch-client &

# on web-standalone
cd web-standalone
yarn install
yarn compile-extension:web-api
yarn generate-extensions-json
yarn dev
# open http://localhost:9090
```

## How to build production and deploy

```bash
# on repository root
# build default `/extensions` and vscode `~/src` to `~/out`
yarn compile

# on web-standalone
cd web-standalone
yarn compile-extension:web-api
yarn generate-extensions-json
yarn build

# Now public directory is static web site!

# example: run local server
npm i -g http-server
http-server -c-1 -p 10000 public

# example: deploy to netlify
npm i -g netlify-cli
netlify deploy --prod -d public
```

## How to include your own extension

See `build-config.json`.

## Problems

Very slow on first time. Maybe vscode web-standalone need bundling.
