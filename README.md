# omegga-select

Mass brick manipulation plugin for [omegga](https://github.com/brickadia-community/omegga).

This plugin adds an extremely powerful command `/select` that allows you to instantly
select, filter, transform, and update bricks in the world.

It implements a small "language" used to filter and transform bricks, which is explained
below.

## Install

`omegga install gh:voximity/select`

## Usage

TODO: put some examples and explanations here

## Deep analysis of usage

All modifications are done using the `/select` and `!select` commands. For the purpose
of this introduction, we will refer to the command as `/select`.

Every time you run a `/select` command, it must be in the following format:

```
/select <filters> <operation> <transforms>
```

Let's start by explaining what each piece of this means.

#### Filters

Filters are ways for you to specify _what_ bricks you want to change. For example,
if you wanted to only select bricks that are metallic, you could use `material(metallic)`
as a filter. This syntax will be clarified more later.

#### Transforms

Transforms describe how your selected bricks will change. For example, if you wanted
to make the bricks in your selection white, you could use `color(255, 255, 255)`.

#### Operations

The `operation` of the command states what will happen to your transformed bricks after
they are transformed. For example, if you want to make changes to your selection and replace
them in the world, use `replace` or `set`.

## Functions

Functions are filters or transforms that have a name, and optionally a list of arguments.

They look like this:

- `function_name()`
- `function_name(arg)`
- `function_name(arg1, arg2)`
- Optionally, remove the parenthesis altogether: `function_name`

All filters are functions, and all transforms are functions. Thus, your select commands will
always look like:

```
/select <filter functions> <operation> <transform functions>
```

## Documentation

### Argument/value types

| Name       | Syntax                                                                                      | Description                                                           | Example                    |
| ---------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------- |
| `boolean`  | `on`/`yes`/`true` or `off`/`no`/`false`                                                     | A boolean value. True or false.                                       | `true` or `false`          |
| `number`   | A number (decimal optional) followed by optional units                                      | A number. Optionally specify units for position/size-based functions. | `1` or `2.5` or `10 studs` |
| `string`   | A word with no spaces, or any text surrounded by single (') or double (") quotes.           | A string of text.                                                     | `hello` or `'hello world'` |
| `function` | See above section.                                                                          | A function, usually a filter.                                         | `color(picker)`            |
| `range`    | `>` or `<`, plus optional `=`, plus `number`                                                | A range. Units are allowed on the number part.                        | `>=5pl`                    |
| `axis`     | `x`, `y`, `z`, `up`/`u`, `down`/`d`, `left`/`l`, `right`/`r`, `forward`/`f`, `backward`/`b` | An axis. Non-XYZ axes are based on where the player is looking.       | `right`                    |

### Units

| Name     | Aliases            | Description                                   |
| -------- | ------------------ | --------------------------------------------- |
| `bricks` | `brick`, `br`, `b` | The height of a brick (1.2 studs). 12 units.  |
| `studs`  | `stud`, `st`, `s`  | The sidelength of a stud. 10 units.           |
| `plates` | `plate`, `pl`      | The height of a plate (1/3 a brick). 4 units. |
| `micros` | `micro`, `m`       | The length of a single microbrick. 2 units.   |

### List of functions that are both filters and transforms

| Name       | Aliases                   | Arguments                                                              | Description                                                                                                                                                                                                                                                                                        | Example                  |
| ---------- | ------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| visibility | `visible`, `vis`, `show`  | `value: boolean`                                                       | Controls/checks the visibility of a brick.                                                                                                                                                                                                                                                         | `visible(off)`           |
| invisible  | `invis`, `hide`, `hidden` |                                                                        | Shorthand for `visibility(off)`.                                                                                                                                                                                                                                                                   | `invisible`              |
| color      | `colour`, `col`           | `"picker"` or `number` or `number, number, number`                     | Controls/checks the color of a brick. When `picker` is specified, uses the color the player has currently selected in their paint tool. If one number is specified, creates a grayscale color from the number 0-255. If three numbers are specified, creates an RGB color, each number from 0-255. | `color(100)`             |
| material   | `mat`                     | `material: string`, `intensity?: number`                               | Control/check the material of a brick. Valid options are `ghost`, `'ghost fail'`, `plastic`, `glow`, `metallic`, `hologram`.                                                                                                                                                                       | `material(glow)`         |
| collision  | `collide`                 | any number of `boolean`, `player`/`p`, `weapon`/`w`, `interaction`/`i` | Controls/checks the collision of a brick. When specifying a boolean argument, all collision flags are set to that value. When specifying a single collision flag (i.e. player, weapon, or interaction), that single flag is enabled.                                                               | `collision(off, player)` |
| decollide  | `uncollide`, `nocollide`  |                                                                        | Shorthand for `collision(off)`.                                                                                                                                                                                                                                                                    | `decollide`              |

### List of filters

| Name                | Aliases            | Arguments                                       | Description                                                                                                                                                                         | Example                        |
| ------------------- | ------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `not`               |                    | `filter: function`                              | Inverts the result of the passed `filter`.                                                                                                                                          | `not(color(picker))`           |
| `or`                |                    | any number of `function`s                       | Evaluates the functions passed until one passes. Boolean OR on all passed functions.                                                                                                | `or(mat(glow), mat(metallic))` |
| `position`          | `pos`, `p`         | `axis: axis`, `value: number` or `value: range` | Checks if the brick's axis position is equal to the value or within the value's range.                                                                                              | `position(x, 0)`               |
| `centerposition`    | `centerpos`, `cp`  | `axis: axis`, `value: number` or `value: range` | Checks if the brick's axis position relative to the center of the selection is equal to the value or within the value's range.                                                      | `cp(right, >0)`                |
| `size`              | `scale`, `s`       | `value:axis`, `value: number` or `value: range` | Checks if the brick's axis size is equal to the value or within the value's range.                                                                                                  | `size(forward, 1br)`           |
| `owner`             |                    | `name: string`, `exact?: 'exact'`               | Checks if the brick's owner matches the passed `name`. If `exact` is specified, then the owner is expected to literally equal `name`. Otherwise, it does a case-insensitive search. | `owner(x, exact)`              |
| `type`              | `brick`, `asset`   | `name: string`                                  | Checks if the brick's asset name contains case-insensitive `name`.                                                                                                                  | `type(micro)`                  |
| `materialintensity` | `intensity`, `int` | `value: number` or `value: range`               | Checks if the brick's material intensity is equal to the value or within the value's range.                                                                                         | `intensity(>=5)`               |

### List of transforms

| Name                | Aliases            | Arguments                     | Description                                                    |
| ------------------- | ------------------ | ----------------------------- | -------------------------------------------------------------- |
| `delete`            | `remove`, `omit`   |                               | Removes the brick from the selection.                          |
| `materialintensity` | `intensity`, `int` | `value: number`               | Sets the brick's intensity from 0-10.                          |
| `translate`         | `t`                | `axis: axis`, `value: number` | Translates the brick by `value` units on the specified `axis`. |
| `resize` | `absr`, `ar`, `r` | `axis: axis`, `amount: number`, `center?: center` | Absolutely resizes a brick along an axis, adding to its current size. |
| `resizeto` | `absrto`, `arto`, `rto`, `rt`, `r2` | `axis: axis`, `amount: number`, `center?: 'center'` | Absolutely resizes a brick along an axis, setting its current size. |