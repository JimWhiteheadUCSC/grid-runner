# Making a pack

A pack is a folder of pieces. Put it in `packs/`, and it appears in the player.

```
packs/my-pack/
  pack.json        optional
  first-piece.js
  second-piece.js
```

A piece is a single JavaScript file that follows the
[piece contract](VFX_API.md). The four pieces in `packs/seeds/` are worked
examples. A `.js` file without the `/*@vfx ... @vfx*/` header is ignored, as is
any file whose name starts with a dot.

To try a piece without a panel, run `npm start` and open
http://localhost:8080.

## pack.json

Every field is optional.

```json
{
  "name": "My Pack",
  "color": [255, 170, 60],
  "pieces": ["second-piece.js", "first-piece.js"]
}
```

| Field | Meaning | Default |
|---|---|---|
| `name` | Shown on the bank card | The folder's name |
| `color` | The bank card's colour, as `[red, green, blue]` from 0 to 255 | A colour from the built-in palette |
| `pieces` | Which pieces to play, in order | Every piece, by filename |

Listed pieces must be inside the pack. A pack with more than 16 pieces is split
into banks named "My Pack 1-16", "My Pack 17-32" and so on.

## Sharing a pack

Put the folder in its own git repository or a zip file, and say in its README
who made it and what license it's under. People install it with:

```bash
cd packs
git clone <your repo>
```

## Multicarts

A multicart is one repository holding several packs. It installs like a pack,
and each pack inside becomes its own bank or banks.

```
packs/my-multicart/
  cart.json
  first-pack/
  second-pack/
```

`cart.json` lists the packs in the order they play, and any folder it doesn't
list is left out:

```json
{
  "name": "My Multicart",
  "packs": ["first-pack", "second-pack"]
}
```

## Arranging your own banks

Packs fill banks automatically. To choose exactly which piece goes on which key
across packs, write a bank file and run the player with `--banks my-banks.json`:

```json
{
  "banks": [
    {
      "name": "Favourites",
      "color": [255, 110, 150],
      "pieces": [
        { "file": "packs/seeds/koi_pond.js", "title": "Koi Pond" },
        null,
        "packs/my-pack/first-piece.js"
      ]
    }
  ]
}
```

Paths are relative to the bank file. Position sets the key, so the first entry
is `1`, the fifth is `Q`, and `null` leaves a key empty. The file is read again
each time you change banks, so you can edit it while the player runs.
