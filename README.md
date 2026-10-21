# Survival Needs (survival-needs)

A module for Foundry VTT 14 and the D&D 5e system 6.0.x. It gives the GM one place to see how long every party member
has gone without **food**, **water** and a **long rest**, tells the GM when a need comes due, and applies hunger, thirst
and exhaustion with one click. **Nothing is applied automatically**: the GM decides every time.

The module watches the game clock (`game.time.worldTime`), so it works with any calendar module. It was built for
Calendaria, where you add hours and minutes by hand or let the clock run.

## Rules it follows (D&D 5e SRD / Player's Handbook)

| Need | Comes due | Penalty |
|---|---|---|
| Food | after 24 h without a meal | You can go `3 + Constitution modifier` days (at least 1) without food. After that, every further full day is 1 exhaustion level. A meal resets the count. |
| Water | after 24 h without drinking | Less than half the daily ration is an automatic exhaustion level; half the ration is a DC 15 Constitution save. A character who is already exhausted gets 2 levels instead of 1. |
| Rest | after 24 h without a long rest | Each further hour needs a DC 10 Constitution save; a failure is 1 exhaustion level. |

The rest limit (24 h) and its DC (10) are world settings, in case your table plays it differently.

Hunger and thirst use dnd5e's own **Malnutrition** and **Dehydration** statuses. While either is on a character, dnd5e
does not let a long rest remove exhaustion, so the penalty sticks until the character eats or drinks.

An hour is 3600 seconds of game time, and a day is 24 of those.

## Who is tracked

The members of dnd5e's **primary party** (open a Group actor, set it as the primary party, add the player characters).
Without a primary party, every player-owned character is tracked. A character starts being tracked at the moment the
module first sees them, with all timers at zero.

Races that need no food or water are skipped for those two needs (Warforged, Autognome, Reborn, Magen, matched by the
race item's name or identifier). Everyone still needs rest. The GM can override any need for any character from the
dashboard (see below).

## The dashboard (GM)

Open it from the **campground button in the Token controls** (left toolbar) or from the header menu of a Group sheet.
One row per character, three cells (Food, Water, Rest). The background of each cell is a fill bar: right after a meal
it is empty and green, and it fills and turns yellow, then red as the time without it approaches the limit (the food
limit is `3 + Con modifier` days, water is one day, rest is the rest limit setting). Once the limit is passed the bar
starts over in red-orange and fills once per day, a shade darker for every full day already overdue. Each cell shows the status (OK / Soon / Due / Overdue), the time
since the last time, how many penalties or saves are owed, and these buttons:

- **Ate / Drank / Rested**: restarts the timer. For food and water a dialog lists the character's consumables of the
  *Food* type (with quantity and charges); pick one and dnd5e's own usage dialog opens, so charges and quantity are
  spent exactly as when the player clicks the item. The timer restarts only if the item was actually used; "No item"
  just marks the time. An optional checkbox also removes one exhaustion level that this module gave for the same need.
- **d20** (water, rest): rolls the Constitution save (DC 15 for water, the configured DC for rest).
- **Warning sign**: applies the penalty: the Malnutrition or Dehydration status where it applies, plus exhaustion.
- **Wand / ban / check**: cycles the override for that need: automatic (by race) → not needed → needed → automatic.

Double-click a name to open the character sheet.

## Chat cards

When a need comes due, the GM gets a whispered chat card: a link to the character, how long ago they last ate, drank or
rested, how long until the time without food runs out, the exhaustion to apply (in red), and a short italic reminder
about the save when one applies. Buttons: "Ate…" / "Drank…" / "Rested" and "Apply hunger" / "Apply thirst" /
"Apply exhaustion". A card is posted once when the need comes due, again when it becomes overdue, and for food
and water again for each further penalty. Only the active GM posts cards.

## Settings (Game Settings → Configure Settings → Module Settings)

| Setting | Default | What it does |
|---|---|---|
| Track needs | on | Turns the timers and cards on or off. |
| Post chat cards to the GM | on | Whisper a card when a need comes due. |
| "Soon" warning | 4 h | How long before a need is due the dashboard highlights it. |
| Hours without a long rest | 24 | Rest limit; every hour after it needs a save. |
| Constitution save DC for missed rest | 10 | DC of that save. |

## Things to know

- Water and food are both items of the *Food* type in dnd5e, so the item dialog lists them together and puts the likely
  ones (by name) first. Items of other types, such as Loot, are not listed; use "No item" or change the item's type.
- When a long rest is finished, the rest timer restarts on its own (dnd5e's `restCompleted` hook). Food and water are
  always marked by hand.
- The module never changes anything on its own: it only starts timers, posts cards and refreshes the dashboard.

## Console fallbacks (F12)

```js
game.modules.get("survival-needs").api.openDashboard()
game.modules.get("survival-needs").api.tick()   // run the timer check now
```

## Tests

```bash
node --test tests/
```
