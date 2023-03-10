import { Value, ValueNumber } from '../lex';
import { BrickV10, ColorRgb, Collision } from 'omegga';
import {
  colorsEqual,
  Context,
  convertNumberValueUnits,
  expectValueType,
  Filter,
  getAxis,
  getContextBounds,
  testNumber,
  Transform,
} from '.';

export const filters: Filter[] = [];
export function addFilter(filter: Filter) {
  filters.push(filter);
}

export const transforms: Transform[] = [];
export function addTransform(transform: Transform) {
  transforms.push(transform);
}

export function deepEquals(a: any, b: any) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((e, i) => deepEquals(e, b[i]));
  } else if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a),
      bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    if (!Object.keys(a).every((k) => k in b)) return false;
    for (const key in a) if (!deepEquals(a[key], b[key])) return false;
    return true;
  }
  return false;
}

export function addFilterAndTransform<K extends keyof BrickV10>(
  aliases: string[],
  prop: K,
  fn:
    | BrickV10[K]
    | ((ctx: Context, args: Value[]) => (brick: BrickV10) => BrickV10[K]),
  compare?: (a: BrickV10[K], b: BrickV10[K], ctx: Context) => boolean
) {
  const cmp = compare ?? deepEquals;

  addFilter({
    aliases,
    fn: (ctx, args) => {
      const value = typeof fn === 'function' ? fn(ctx, args) : () => fn;
      return (brick) => cmp(brick[prop], value(brick), ctx);
    },
  });
  addTransform({
    aliases,
    fn: (ctx, args) => {
      const value = typeof fn === 'function' ? fn(ctx, args) : () => fn;
      return (brick) => {
        brick[prop] = value(brick);
      };
    },
  });
}

export function memo<T>(value: T) {
  return () => value;
}

//
// Filters
//

addFilter({
  aliases: ['not'],
  fn: (ctx, args) => {
    if (args.length === 0) throw { message: 'expected_fn' };
    let fnname: string, fnargs: Value[];
    if (args[0].type === 'function') {
      fnname = args[0].value.name;
      fnargs = args[0].value.args;
    } else if (args[0].type === 'string') {
      fnname = args[0].value;
      fnargs = [];
    } else throw { message: 'expected_fn' };

    const filter = filterMap.get(fnname);
    if (!filter) throw { message: 'unknown_filter' };
    const fn = filter.fn(ctx, fnargs);

    return (brick) => !fn(brick);
  },
});

addFilter({
  aliases: ['or'],
  fn: (ctx, args) => {
    if (args.length === 0) throw { message: 'expected_fn' };
    const fns: ((brick: BrickV10) => boolean)[] = [];
    for (const arg of args) {
      let fnname: string, fnargs: Value[];
      if (arg.type === 'function') {
        fnname = arg.value.name;
        fnargs = arg.value.args;
      } else if (arg.type === 'string') {
        fnname = arg.value;
        fnargs = [];
      } else throw { message: 'expected_fn' };

      const obj = filterMap.get(fnname);
      if (!obj) throw { message: 'unknown_filter', filter: fnname };

      fns.push(obj.fn(ctx, fnargs));
    }

    return (brick) => fns.some((fn) => fn(brick));
  },
});

addFilter({
  aliases: ['and'],
  fn: (ctx, args) => {
    if (args.length === 0) throw { message: 'expected_fn' };
    const fns: ((brick: BrickV10) => boolean)[] = [];
    for (const arg of args) {
      let fnname: string, fnargs: Value[];
      if (arg.type === 'function') {
        fnname = arg.value.name;
        fnargs = arg.value.args;
      } else if (arg.type === 'string') {
        fnname = arg.value;
        fnargs = [];
      } else throw { message: 'expected_fn' };

      const obj = filterMap.get(fnname);
      if (!obj) throw { message: 'unknown_filter', filter: fnname };

      fns.push(obj.fn(ctx, fnargs));
    }

    return (brick) => fns.every((fn) => fn(brick));
  },
});

// positions
addFilter({
  aliases: ['position', 'pos', 'p'],
  fn: (ctx, args) => {
    if (args.length < 2 || args[0].type !== 'string')
      throw { message: 'expected_axis_and_number' };
    const [axis, factor] = getAxis(ctx, args[0].value);
    if (args[1].type === 'number') args[1].value *= factor;
    else if (args[1].type === 'range') {
      if (args[1].min) args[1].min *= factor;
      if (args[1].max) args[1].max *= factor;
    }
    const test = testNumber(convertNumberValueUnits(args[1]));
    return (brick) => test(brick.position[axis]);
  },
});

// center positions
addFilter({
  aliases: ['centerposition', 'centerpos', 'cp'],
  fn: (ctx, args) => {
    if (args.length < 2 || args[0].type !== 'string')
      throw { message: 'expected_axis_and_number' };
    const [axis, factor] = getAxis(ctx, args[0].value);
    if (args[1].type === 'number') args[1].value *= factor;
    else if (args[1].type === 'range') {
      if (args[1].min) args[1].min *= factor;
      if (args[1].max) args[1].max *= factor;
    }
    const test = testNumber(convertNumberValueUnits(args[1]));
    const ref = getContextBounds(ctx).center[axis];
    return (brick) => test(brick.position[axis] - ref);
  },
});

// sizes
addFilter({
  aliases: ['size', 'scale', 's'],
  fn: (ctx, args) => {
    if (args.length < 2 || args[0].type !== 'string')
      throw { message: 'expected_axis_and_number' };
    const [axis, factor] = getAxis(ctx, args[0].value);
    if (args[1].type === 'number') args[1].value *= factor;
    else if (args[1].type === 'range') {
      if (args[1].min) args[1].min *= factor;
      if (args[1].max) args[1].max *= factor;
    }
    const test = testNumber(convertNumberValueUnits(args[1]));
    return (brick) =>
      test(
        OMEGGA_UTIL.brick.getBrickSize(brick, ctx.save.brick_assets)[axis] * 2
      );
  },
});

addFilter({
  aliases: ['owner'],
  fn: (ctx, args) => {
    if (args.length === 0) throw { message: 'expected_owner' };
    if (args[0].type !== 'string') throw { message: 'expected_name' };
    let exact = false;
    if (
      args[1] &&
      args[1].type === 'string' &&
      args[1].value.toLowerCase() === 'exact'
    )
      exact = true;

    const value = args[0].value;

    if (value.toLowerCase() === 'public')
      return (brick) => brick.owner_index === 0;

    if (exact)
      return (brick) => {
        if (brick.owner_index === 0) return false;
        const owner = ctx.save.brick_owners[brick.owner_index - 1];
        return owner.name === value;
      };

    const valLower = value.toLowerCase();
    return (brick) => {
      if (brick.owner_index === 0) return false;
      const owner = ctx.save.brick_owners[brick.owner_index - 1];
      return owner.name.toLowerCase().includes(valLower);
    };
  },
});

addFilter({
  aliases: ['type', 'brick', 'asset'],
  fn: (ctx, args) => {
    if (args.length === 0) throw { message: 'expected_type' };
    if (args[0].type !== 'string') throw { message: 'expected_type' };

    const value = args[0].value.toLowerCase();
    const matches = ctx.save.brick_assets
      .map<[string, number]>((a, i) => [a, i])
      .filter(([a]) => a.toLowerCase().includes(value));
    const set = new Set();
    for (const [_, i] of matches) set.add(i);

    return (brick) => set.has(brick.asset_name_index);
  },
});

addFilter({
  aliases: ['materialintensity', 'intensity', 'int'],
  fn: (ctx, args) => {
    if (
      args.length === 0 ||
      (args[0].type !== 'number' && args[0].type !== 'range')
    )
      throw { message: 'expected_intensity' };

    const test = testNumber(args[0]);

    return (brick) => test(brick.material_intensity);
  },
});

addFilter({
  aliases: ['material', 'mat'],
  fn: (ctx, args) => {
    if (args.length === 0) throw { message: 'expected_material' };
    if (args[0].type !== 'string') throw { message: 'expected_material' };
    if (
      args[1] &&
      (args[1].type !== 'number' || args[1].value < 0 || args[1].value > 10)
    )
      throw { message: 'bad_intensity' };

    const matName =
      'BMC_' +
      args[0].value
        .split(' ')
        .map((v) => v[0].toUpperCase() + v.slice(1).toLowerCase());

    if (!OMEGGA_UTIL.brick.BRICK_CONSTANTS.DEFAULT_MATERIALS.includes(matName))
      throw { message: 'unknown_material' };

    let index = ctx.save.materials.indexOf(matName);
    if (index === -1) return () => false;

    const intensity = (args[1] as ValueNumber)?.value;
    if (intensity)
      return (brick) =>
        brick.material_index === index &&
        brick.material_intensity === intensity;
    else return (brick) => brick.material_index === index;
  },
});

//
// Transforms
//

addTransform({
  aliases: ['delete', 'remove', 'omit'],
  fn: () => () => false,
});

addTransform({
  aliases: ['materialintensity', 'intensity', 'int'],
  fn: (ctx, args) => {
    if (args.length === 0 || args[0].type !== 'number')
      throw { message: 'expected_intensity' };

    if (args[0].value < 0 || args[0].value > 10)
      throw { message: 'bad_intensity' };

    const val = args[0].value;

    return (brick) => {
      brick.material_intensity = val;
    };
  },
});

// translate coordinates
addTransform({
  aliases: ['translate', 't'],
  fn: (ctx, args) => {
    if (
      args.length < 2 ||
      args[0].type !== 'string' ||
      args[1].type !== 'number'
    )
      throw { message: 'expected_axis_and_number' };

    const [axis, factor] = getAxis(ctx, args[0].value);
    const value =
      (convertNumberValueUnits(args[1]) as ValueNumber).value * factor;
    return (brick) => {
      brick.position[axis] += value;
    };
  },
});

// local resize
addTransform({
  aliases: ['localresize', 'lr'],
  fn: (ctx, args) => {
    if (
      args.length < 2 ||
      args[0].type !== 'string' ||
      args[1].type !== 'number'
    )
      throw { message: 'expected_number' };

    const [axis, factor] = getAxis(ctx, args[0].value);
    let value =
      (convertNumberValueUnits(args[1]) as ValueNumber).value * factor;

    let dir = 'min';
    if (args[2] && args[2].type === 'string' && args[2].value === 'center') {
      dir = undefined;
    }

    if (value < 0) {
      value = -value;
      if (dir) dir = dir === 'min' ? 'max' : 'min';
    }

    const half = Math.round(value / 2);
    if (dir) {
      return (brick) => {
        const old = brick.size[axis];
        brick.size[axis] = half;
        brick.position[OMEGGA_UTIL.brick.getScaleAxis(brick, axis)] +=
          dir === 'min' ? half - old : old - half;
      };
    }

    return (brick) => {
      brick.size[axis] = half;
    };
  },
});

// absolute resize to
addTransform({
  aliases: ['rt', 'r2', 'rto', 'arto', 'absrto', 'resizeto'],
  fn: (ctx, args) => {
    if (
      args.length < 2 ||
      args[0].type !== 'string' ||
      args[1].type !== 'number'
    )
      throw { message: 'expected_number' };

    const [axis, factor] = getAxis(ctx, args[0].value);
    let value =
      (convertNumberValueUnits(args[1]) as ValueNumber).value * factor;

    let dir = 'min';
    if (args[2] && args[2].type === 'string' && args[2].value === 'center') {
      dir = undefined;
    }

    if (value < 0) {
      value = -value;
      if (dir) dir = dir === 'min' ? 'max' : 'min';
    }

    const half = Math.round(value / 2);
    if (dir) {
      return (brick) => {
        const sidx = OMEGGA_UTIL.brick.getScaleAxis(brick, axis);
        const old = brick.size[sidx];
        brick.size[sidx] = half;
        brick.position[axis] += dir === 'min' ? half - old : old - half;
      };
    }

    return (brick) => {
      brick.size[axis] = half;
    };
  },
});

// absolute resize (additive)
addTransform({
  aliases: ['r', 'ar', 'absr', 'resize'],
  fn: (ctx, args) => {
    if (
      args.length < 2 ||
      args[0].type !== 'string' ||
      args[1].type !== 'number'
    )
      throw { message: 'expected_number' };

    const [axis, factor] = getAxis(ctx, args[0].value);
    let value = (convertNumberValueUnits(args[1]) as ValueNumber).value;

    let dir = 'min';
    if (args[2] && args[2].type === 'string' && args[2].value === 'center') {
      dir = undefined;
    }

    if (factor < 0) {
      // value = -value;
      if (dir) dir = dir === 'min' ? 'max' : 'min';
    }

    const half = Math.round(value / 2);
    if (dir) {
      return (brick) => {
        const sidx = OMEGGA_UTIL.brick.getScaleAxis(brick, axis);
        brick.size[sidx] += half;
        if (brick.size[sidx] <= 0) return false;
        brick.position[axis] += dir === 'min' ? half : -half;
      };
    }

    return (brick) => {
      brick.size[axis] += half;
      if (brick.size[axis] <= 0) return false;
    };
  },
});

addTransform({
  aliases: ['material', 'mat'],
  fn: (ctx, args) => {
    if (args.length === 0) throw { message: 'expected_material' };
    if (args[0].type !== 'string') throw { message: 'expected_material' };
    if (
      args[1] &&
      (args[1].type !== 'number' || args[1].value < 0 || args[1].value > 10)
    )
      throw { message: 'bad_intensity' };

    const matName =
      'BMC_' +
      args[0].value
        .split(' ')
        .map((v) => v[0].toUpperCase() + v.slice(1).toLowerCase());

    if (!OMEGGA_UTIL.brick.BRICK_CONSTANTS.DEFAULT_MATERIALS.includes(matName))
      throw { message: 'unknown_material' };

    let index = ctx.save.materials.indexOf(matName);
    if (index === -1) index = ctx.save.materials.push(matName) - 1;

    const intensity = (args[1] as ValueNumber | undefined)?.value;

    return (brick) => {
      brick.material_index = index;
      if (intensity !== undefined) brick.material_intensity = intensity;
    };
  },
});

//
// Common
//

// visible
addFilterAndTransform(
  ['visibility', 'visible', 'vis', 'show'],
  'visibility',
  (ctx: Context, args: Value[]) => {
    const value = args[0] && args[0].type === 'boolean' ? args[0].value : true;
    return memo(value);
  }
);

// invisible
addFilterAndTransform(
  ['invisible', 'invis', 'hide', 'hidden'],
  'visibility',
  false
);

// color
addFilterAndTransform(
  ['color', 'colour', 'col'],
  'color',
  (ctx: Context, args: Value[]) => {
    // text 'picker'
    if (
      args.length === 0 ||
      (args[0].type === 'string' && args[0].value === 'picker')
    )
      return memo(ctx.playerColor as ColorRgb);

    // grayscale
    if (args.length === 1 && args[0].type === 'number')
      return memo([args[0].value, args[0].value, args[0].value] as ColorRgb);

    // RGB
    if (args.length === 3 && args.every((a) => a.type === 'number'))
      return memo(args.map((a) => a['value'] as number) as ColorRgb);

    throw { message: 'no_color' };
  },
  (a, b, ctx) => {
    const toCol = (c: number | ColorRgb) =>
      typeof c === 'number' ? ctx.save.colors[c] : c;
    return colorsEqual(toCol(a), toCol(b));
  }
);

addFilterAndTransform(
  ['collision', 'collide'],
  'collision',
  (ctx: Context, args: Value[]) => {
    if (args.length === 0)
      return memo({
        player: true,
        weapon: true,
        interaction: true,
        tool: true,
      });

    let collision: Partial<Collision> = {};
    for (const arg of args) {
      if (arg.type === 'string' || arg.type === 'boolean') {
        switch (arg.value.toString()) {
          case 'true':
            collision = {
              player: true,
              weapon: true,
              interaction: true,
              tool: true,
            };
            break;
          case 'false':
            collision = {
              player: false,
              weapon: false,
              interaction: false,
              tool: true,
            };
            break;
          case 'player':
          case 'p':
            collision.player = true;
            break;
          case 'weapon':
          case 'w':
            collision.weapon = true;
            break;
          case 'interaction':
          case 'i':
            collision.interaction = true;
            break;
          default:
            break;
        }
      } else throw { message: 'bad_flag' };
    }

    return (brick) => ({ ...brick.collision, ...collision });
  }
);

addFilterAndTransform(['decollide', 'uncollide', 'nocollide'], 'collision', {
  player: false,
  weapon: false,
  interaction: false,
  tool: true,
});

export const filterMap: Map<string, Filter> = new Map();
export const transformMap: Map<string, Transform> = new Map();

for (const filter of filters)
  for (const alias of filter.aliases) filterMap.set(alias, filter);
for (const transform of transforms)
  for (const alias of transform.aliases) transformMap.set(alias, transform);
