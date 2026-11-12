# Meu Canva

Player de apresentações offline para telões de LED de qualquer proporção.
A edição continua no Canva; o player só exibe as páginas exportadas.

- Abre com dois cliques em `dist/index.html`, no Chrome ou no Edge, sem servidor e sem internet.
- O slide ocupa o máximo da tela mantendo a proporção original, com fundo preto (16:9, 10:3, 32:9, qualquer formato).
- HTML, CSS e JavaScript puros, sem dependências.

## Passo a passo

### 1. Exportar do Canva

**Páginas (PNG)**

1. No Canva, clique em **Compartilhar → Baixar**.
2. Em **Tipo de arquivo**, escolha **PNG** e leve o controle de **Tamanho** ao máximo (qualidade Pro).
3. Selecione todas as páginas e baixe. Com mais de uma página o Canva entrega um arquivo **ZIP**.

**Páginas com vídeo (MP4)**

1. Em **Compartilhar → Baixar**, escolha **Vídeo MP4**.
2. Selecione **apenas uma página** com vídeo por vez e baixe.
3. Renomeie o arquivo para o número da página, por exemplo `0003.mp4` para a página 3.

O vídeo substitui a imagem daquela página; a imagem continua sendo usada como capa enquanto o vídeo carrega.

### 2. Colocar em `input/`

Apague os slides de exemplo que vêm em `input/` e coloque os seus. Qualquer uma destas formas funciona:

- O ZIP do Canva direto, sem descompactar.
- Os PNGs soltos: `0001.png`, `0002.png`, ...
- As duas coisas juntas, mais os MP4.

O número da página é o **último número do nome do arquivo**, então `0003.png`, `3.png` e `Minha apresentação - 3.png` são todos a página 3.
Se a mesma página aparecer solta e dentro do ZIP, vale o arquivo solto.

### 3. Gerar o player

É preciso ter o [Node.js](https://nodejs.org) 18 ou mais novo instalado. Na pasta do projeto:

```bash
npm run build
```

O comando extrai os ZIPs, copia tudo para `dist/slides/` e gera `dist/slides.js` com a lista de páginas.
Não é preciso rodar `npm install`.

### 4. Abrir

Dê dois cliques em `dist/index.html` e aperte **F** para tela cheia.

Para levar a outro computador, copie a pasta `dist/` inteira (pen drive, por exemplo). Ela funciona sozinha.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `→` `↓` `Espaço` `PageDown` `Enter`, clique | Próxima página |
| `←` `↑` `PageUp` `Backspace`, clique direito | Página anterior |
| `Home` / `End` | Primeira / última página |
| número + `Enter` | Pular para a página |
| `G` | Grade com todos os slides, para escolher um |
| `F` | Tela cheia |
| `B` ou `.` | Tela preta |
| `L` | Liga/desliga o ponteiro laser |
| `N` | Mostra/esconde o contador de página |
| `H` | Mostra os atalhos |
| `Esc` | Sai da tela cheia, da tela preta, da grade ou da ajuda |

Passadores de slide funcionam, porque enviam `PageUp`/`PageDown`.

Com a tela preta ligada, a primeira tecla de navegação só traz o slide de volta, sem trocar de página.

**Grade de slides:** `G` abre uma grade com miniaturas de todas as páginas. Clique em uma, ou escolha com as setas e confirme com `Enter`. `Esc` ou `G` fecha sem trocar de página.

**Ponteiro laser:** ao mexer o mouse, um ponto azul discreto aparece no lugar do cursor e some depois de 2 segundos parado. Funciona também sobre os vídeos.
Com o laser desligado (`L`), aparece o cursor normal, que também some quando o mouse para.

## Configuração

Edite `player.config.json` e rode `npm run build` de novo.

```json
{
  "titulo": "Meu Canva",
  "transicaoMs": 300,
  "laser": true,
  "laserOcultarMs": 2000,
  "contador": false,
  "loop": false,
  "paginas": {
    "3": { "som": true },
    "7": { "loop": false }
  }
}
```

| Opção | O que faz |
| --- | --- |
| `transicaoMs` | Duração do fade entre slides, em milissegundos. `0` desliga. |
| `laser` | Se o ponteiro laser começa ligado. |
| `laserOcultarMs` | Tempo parado até o ponteiro sumir. |
| `contador` | Se o contador de página começa visível. |
| `loop` | Se a apresentação volta ao início depois da última página. |
| `paginas` | Opções por página, pelo número. Só valem para páginas com vídeo. |

Opções por página:

- `som`: `true` toca o vídeo com som. O padrão é mudo.
- `loop`: `false` toca o vídeo uma vez e para no último quadro. O padrão é repetir.

Essas opções vão para `dist/slides.js`. Dá para editar o `slides.js` direto, mas o próximo build sobrescreve; o lugar permanente é o `player.config.json`.

**Som:** o Chrome só libera áudio depois de alguma tecla ou clique na página. Se a apresentação abrir direto numa página com som, o vídeo começa mudo e o som entra na primeira tecla ou clique.

## Versão web (GitHub Pages)

A cada envio para o branch `main`, o GitHub gera o `dist/` e publica no branch `gh-pages`. O endereço é:

https://ghorcades.github.io/my-canva/

Se o endereço não abrir, ative uma vez em **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **gh-pages**, pasta **/ (root)**.

Para atualizar a versão web, troque os arquivos de `input/` e envie para o GitHub:

```bash
git add -A
```

```bash
git commit -m "Atualiza slides"
```

```bash
git push
```

Atenção:

- O endereço é público: qualquer pessoa com o link vê os slides que estiverem em `input/`.
- O GitHub recusa arquivos acima de 100 MB, o que pode acontecer com vídeos longos. Nesse caso, use só a versão local.

## Estrutura

```
input/               páginas exportadas do Canva (PNG, MP4 ou ZIP)
player.config.json   opções do player
scripts/build.mjs    gera dist/ a partir de input/
src/player/          código do player (HTML, CSS, JS)
dist/                resultado do build; é isto que vai para o telão
```
