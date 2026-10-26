# Avisos de terceiros

O `@zolvency-cmi/core` embute, no seu `dist/`, o código do **`@ctd/sdk`** (o SDK do demo do
Confidential Token: Grumpkin, Poseidon2 do token, chaves, witness de `register`), porque esse pacote
não é publicado no npm (S-05 do `docs/DECISIONS.md`, revisada no passo 6.5).

- Origem: `stellar-confidential-token-demo`, `packages/sdk`, commit `9500ed774b13b08b5fe99370b60de3479edb492b`
  (o submódulo `third_party/stellar-confidential-token-demo` do repositório sdk).
- Licença: MIT, como o projeto declara no `package.json` e no README. O repositório do demo não
  traz um arquivo de licença com o texto e o titular.

O texto da licença MIT:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
> BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
