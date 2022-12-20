import {
  BrickBounds,
  BrickV10,
  BrsV10,
  OmeggaPlayer,
  ReadSaveObject,
} from 'omegga';
import Plugin, { backups } from '../omegga.plugin';
import { Op, ParseResult, Value } from '../lex';
import { filterMap, transformMap } from './funcs';

export type Context = {
  save: BrsV10;
  saveBounds?: BrickBounds;
  player: OmeggaPlayer;
  playerColor: number[];
  playerTransform: PlayerTransform;
  localFilters: ReturnType<Filter['fn']>[];
  localTransforms: ReturnType<Transform['fn']>[];
};

export type Filter = {
  aliases: string[];
  fn: (ctx: Context, args: Value[]) => (brick: BrickV10) => boolean;
};

export type Transform = {
  aliases: string[];
  fn: (ctx: Context, args: Value[]) => (brick: BrickV10) => boolean | void;
};

export type InterpretResult = {
  total: number;
  filtered: number;
};

export type PlayerTransform = {
  x: number;
  y: number;
  z: number;
  pitch: number;
  yaw: number;
  roll: number;
};

export type SaveBackup = {
  data: BrsV10;
  bounds?: BrickBounds;
};

export function colorsEqual(a: number[], b: number[]) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function pluralize(n: number, noun: string) {
  return noun + (n === 1 ? '' : 's');
}

export function expectValueType(value: Value, type: Value['type']) {
  if (value.type === type) return value;
  else throw { message: 'bad_value_type' };
}

export function testNumber(against: Value): (value: number) => boolean {
  if (against.type === 'number')
    return (value: number) => value === against.value;
  else if (against.type === 'range') {
    // check max
    return (value) => {
      if (
        against.max != null &&
        value >= against.max &&
        (against.maxEx ? true : value !== against.max)
      )
        return false;

      // check min
      if (
        against.min != null &&
        value <= against.min &&
        (against.minEx ? true : value !== against.min)
      )
        return false;

      return true;
    };
  } else throw { message: 'bad_number_or_range' };
}

export function getContextBounds(ctx: Context) {
  if (ctx.saveBounds) return ctx.saveBounds;
  ctx.saveBounds = OMEGGA_UTIL.brick.getBounds(ctx.save);
  return ctx.saveBounds;
}

export function numberUnits(n: number, units: string) {
  switch (units) {
    case 'bricks':
    case 'brick':
    case 'br':
    case 'b':
      return n * 12;
    case 'studs':
    case 'stud':
    case 'st':
    case 's':
      return n * 10;
    case 'plates':
    case 'plate':
    case 'pl':
      return n * 4;
    case 'micros':
    case 'micro':
    case 'm':
      return n * 2;
    case undefined:
    case null:
    case '':
      return n;
    default:
      throw { message: 'unknown_units' };
  }
}

export function convertNumberValueUnits(value: Value): Value {
  if (value.type !== 'number' && value.type !== 'range') return value;
  if (value.type === 'number') {
    return { type: 'number', value: numberUnits(value.value, value.units) };
  } else if (value.type === 'range') {
    return {
      type: 'range',
      max:
        value.max && value.maxUnits
          ? numberUnits(value.max, value.maxUnits)
          : value.max,
      maxEx: value.maxEx,
      min:
        value.min && value.minUnits
          ? numberUnits(value.min, value.minUnits)
          : value.min,
      minEx: value.minEx,
    };
  }
}

async function getPlayerTransform(player: string): Promise<PlayerTransform> {
  const match = await Omegga.watchLogChunk(
    `Chat.Command /GetTransform ${player}`,
    /Transform: X=(-?[0-9,.]+) Y=(-?[0-9,.]+) Z=(-?[0-9,.]+) Roll=(-?[0-9,.]+) Pitch=(-?[0-9,.]+) Yaw=(-?[0-9,.]+)/,
    { first: (match) => match[0].startsWith('Transform:'), timeoutDelay: 1000 }
  );

  const result = {
    x: match[0][1],
    y: match[0][2],
    z: match[0][3],
    roll: match[0][4],
    pitch: match[0][5],
    yaw: match[0][6],
  };

  return Object.fromEntries(
    Object.entries(result).map(([k, n]) => [k, parseFloat(n.replace(',', ''))])
  ) as PlayerTransform;
}

const YAW_AXES = [
  [0, -1],
  [1, -1],
  [0, 1],
  [1, 1],
];

export function getYawAxis(yaw: number): [number, number] {
  return YAW_AXES[Math.floor(((yaw + 225) % 360) / 90)] as [number, number];
}

/** Get an axis from its name. Returns [axis, factor]. */
export function getAxis(ctx: Context, name: string): [number, number] {
  switch (name.toLowerCase()) {
    case 'x':
      return [0, 1];
    case 'y':
      return [1, 1];
    case 'z':
      return [2, 1];
    case 'top':
    case 'up':
    case 'u':
      return [2, 1];
    case 'bottom':
    case 'down':
    case 'd':
      return [2, -1];
    case 'forward':
    case 'front':
    case 'f':
      return getYawAxis(ctx.playerTransform.yaw);
    case 'backward':
    case 'back':
    case 'b':
      return getYawAxis(ctx.playerTransform.yaw + 180);
    case 'left':
    case 'l':
      return getYawAxis(ctx.playerTransform.yaw + 270);
    case 'right':
    case 'r':
      return getYawAxis(ctx.playerTransform.yaw + 90);
    default:
      throw { message: 'unknown_axis' };
  }
}

export default class Interpreter {
  parsed: ParseResult;

  constructor(parsed: ParseResult) {
    this.parsed = parsed;
  }

  interpret = async (
    plugin: Plugin,
    player: OmeggaPlayer
  ): Promise<InterpretResult> => {
    let save: ReadSaveObject;
    let bounds: BrickBounds;
    try {
      if (this.parsed.all) {
        save = await Omegga.getSaveData();
      } else {
        bounds = await player.getTemplateBounds();
        save = await player.getTemplateBoundsData();
      }
    } catch (e) {
      throw { message: 'no_bricks_selected' };
    }

    if (!save) throw { message: 'no_bricks_selected' };
    if (save.version !== 10) throw { message: 'bad_version' };

    if (this.parsed.op === Op.Delete) {
      this.parsed.op = Op.Replace;
      this.parsed.transforms = [{ name: 'delete', args: [] }];
    }

    if (
      plugin.config['create-backups'] &&
      (this.parsed.op === Op.Replace || this.parsed.op === Op.Extract)
    ) {
      const backup: SaveBackup = {
        data: JSON.parse(
          JSON.stringify(save)
        ) /* yes this is horrible and scary */,
        bounds,
      };
      backups[player.id] = backup;
    }

    const ctx: Context = {
      save,
      saveBounds: bounds,
      player,
      playerColor: (await player.getPaint()).color,
      playerTransform: await getPlayerTransform(player.name),
      localFilters: [],
      localTransforms: [],
    };

    for (const filter of this.parsed.filters) {
      const obj = filterMap.get(filter.name.toLowerCase());
      if (!obj) throw { message: 'unknown_filter', name: filter.name };
      ctx.localFilters.push(obj.fn(ctx, filter.args));
    }

    for (const transform of this.parsed.transforms) {
      const obj = transformMap.get(transform.name.toLowerCase());
      if (!obj) throw { message: 'unknown_transform', name: transform.name };
      ctx.localTransforms.push(obj.fn(ctx, transform.args));
    }

    let filteredCount = 0;
    let deletedCount = 0;

    const filterBricks = [];
    for (let i = 0; i < save.bricks.length; i++) {
      let inFilter = true;
      for (let j = 0; j < this.parsed.filters.length; j++) {
        if (!ctx.localFilters[j](save.bricks[i])) {
          inFilter = false;
          break;
        }
      }

      if (!inFilter) continue;

      let deleted = false;
      filteredCount++;

      for (let j = 0; j < this.parsed.transforms.length; j++) {
        if (ctx.localTransforms[j](save.bricks[i]) === false) {
          save.bricks.splice(i--, 1);
          filteredCount--;
          deletedCount++;
          deleted = true;
          break;
        }
      }

      if (this.parsed.op === Op.Extract && !deleted) {
        filterBricks.push(save.bricks[i]);
        save.bricks.splice(i--, 1);
      }
    }

    if (filteredCount === 0 && deletedCount === 0) {
      Omegga.middlePrint(player.id, `No bricks changed`);
    }

    if (this.parsed.op === Op.Replace) {
      if (this.parsed.all) {
        Omegga.clearAllBricks(true);
        if (save.bricks.length > 0) Omegga.loadSaveData(save, { quiet: true });
      } else {
        Omegga.clearRegion({
          center: bounds.center,
          extent: bounds.maxBound.map((c, i) => c - bounds.center[i]) as [
            number,
            number,
            number
          ],
        });
        if (save.bricks.length > 0) Omegga.loadSaveData(save, { quiet: true });
      }

      Omegga.middlePrint(
        player.id,
        `Replaced selected bricks<br>${filteredCount.toLocaleString()} ${pluralize(
          filteredCount,
          'brick'
        )} replaced${
          deletedCount > 0
            ? `, ${deletedCount.toLocaleString()} ${pluralize(
                deletedCount,
                'brick'
              )} deleted`
            : ''
        }`
      );
    } else if (this.parsed.op === Op.Copy) {
      if (save.bricks.length > 0) player.loadSaveData(save, { quiet: true });
      Omegga.middlePrint(
        player.id,
        `Copied selected bricks<br>${save.bricks.length.toLocaleString()} ${pluralize(
          save.bricks.length,
          'brick'
        )} copied, ${filteredCount.toLocaleString()} affected`
      );
    } else if (this.parsed.op === Op.Extract) {
      if (this.parsed.all) {
        Omegga.clearAllBricks(true);
        if (save.bricks.length > 0) Omegga.loadSaveData(save, { quiet: true });
      } else {
        Omegga.clearRegion({
          center: bounds.center,
          extent: bounds.maxBound.map((c, i) => c - bounds.center[i]) as [
            number,
            number,
            number
          ],
        });
        if (save.bricks.length > 0) Omegga.loadSaveData(save, { quiet: true });
      }

      if (filterBricks.length > 0)
        await player.loadSaveData(
          { ...save, bricks: filterBricks },
          { quiet: true }
        );

      Omegga.middlePrint(
        player.id,
        `Extracted selected bricks<br>${filterBricks.length.toLocaleString()} ${pluralize(
          filterBricks.length,
          'brick'
        )} extracted`
      );
    } else if (this.parsed.op === Op.Count) {
      Omegga.whisper(
        player.id,
        'Filtered <color="ff0">' +
          filteredCount.toLocaleString() +
          '</> ' +
          pluralize(filteredCount, 'brick') +
          ' out of <color="ff0">' +
          save.bricks.length.toLocaleString() +
          '</>.'
      );
    } else {
      throw { message: 'unsupported_op', op: this.parsed.op };
    }

    return { total: save.bricks.length, filtered: filteredCount };
  };
}
