import {
  BrickBounds,
  BrickV10,
  BrsV10,
  OmeggaPlayer,
  ReadSaveObject,
} from 'omegga';
import { Op, ParseResult, Value } from '../lex';
import { filterMap, transformMap } from './funcs';

export type Context = {
  save: BrsV10;
  player: OmeggaPlayer;
  playerColor: number[];
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
        value > against.max &&
        (against.maxEx ? true : value !== against.max)
      )
        return false;

      // check min
      if (
        against.min != null &&
        value < against.min &&
        (against.minEx ? true : value !== against.min)
      )
        return false;

      return true;
    };
  } else throw { message: 'bad_number_or_range' };
}

export default class Interpreter {
  parsed: ParseResult;

  constructor(parsed: ParseResult) {
    this.parsed = parsed;
  }

  interpret = async (player: OmeggaPlayer): Promise<InterpretResult> => {
    let save: ReadSaveObject;
    let bounds: BrickBounds;
    try {
      if (this.parsed.all) save = await Omegga.getSaveData();
      else {
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

    const ctx: Context = {
      save,
      player,
      playerColor: (await player.getPaint()).color,
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
