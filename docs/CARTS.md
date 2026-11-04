# Making a cart

A cart is a folder of pieces. Put it in `carts/`, and it appears in the player.

```
carts/my-cart/
  cart.json        optional
  first-piece.js
  second-piece.js
```

A piece is a single JavaScript file that follows the
[piece contract](VFX_API.md). The four pieces in `carts/seeds/` are worked
examples. A `.js` file without the `/*@vfx ... @vfx*/` header is ignored, as is
any file whose name starts with a dot.

To try a piece without a panel, run `npm start` and open
http://localhost:8080.

## cart.json

Every field is optional.

```json
{
  "name": "My Cart",
  "color": [255, 170, 60],
  "pieces": ["second-piece.js", "first-piece.js"]
}
```

| Field | Meaning | Default |
|---|---|---|
| `name` | Shown on the bank card | The folder's name |
| `color` | The bank card's colour, as `[red, green, blue]` from 0 to 255 | A colour from the built-in palette |
| `pieces` | Which pieces to play, in order | Every piece, by filename |

Listed pieces must be inside the cart. A cart with more than 16 pieces is split
into banks named "My Cart 1-16", "My Cart 17-32" and so on.

## Sharing a cart

Put the folder in its own git repository or a zip file, and say in its README
who made it and what license it's under. People install it with:

```bash
cd carts
git clone <your repo>
```

## Multicarts

A multicart is one repository holding several carts. It installs like a cart,
and each cart inside becomes its own bank or banks.

```
carts/my-multicart/
  multicart.json
  first-cart/
  second-cart/
```

`multicart.json` lists the carts in the order they play, and any folder it doesn't
list is left out:

```json
{
  "name": "My Multicart",
  "carts": ["first-cart", "second-cart"]
}
```

## Arranging your own banks

Carts fill banks automatically. To choose exactly which piece goes on which key
across carts, write a bank file and run the player with `--banks my-banks.json`:

```json
{
  "banks": [
    {
      "name": "Favourites",
      "color": [255, 110, 150],
      "pieces": [
        { "file": "carts/seeds/koi_pond.js", "title": "Koi Pond" },
        null,
        "carts/my-cart/first-piece.js"
      ]
    }
  ]
}
```

Paths are relative to the bank file. Position sets the key, so the first entry
is `1`, the fifth is `Q`, and `null` leaves a key empty. The file is read again
each time you change banks, so you can edit it while the player runs.
