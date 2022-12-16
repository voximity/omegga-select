export type ValueBoolean = { type: 'boolean'; value: boolean };
export type ValueNumber = { type: 'number'; value: number; units?: string };
export type ValueString = { type: 'string'; value: string };
export type ValueFunc = { type: 'function'; value: Func };
export type ValueRange = {
  type: 'range';
  /** The lower bound. */
  min?: number;
  /** The upper bound. */
  max?: number;
  /** The lower bound units. */
  minUnits?: string;
  /** The upper bound units. */
  maxUnits?: string;
  /** Whether or not the minimum is exclusive. */
  minEx?: boolean;
  /** Whether or not the maximum is exclusive. */
  maxEx?: boolean;
};
export type Value =
  | ValueBoolean
  | ValueNumber
  | ValueString
  | ValueRange
  | ValueFunc;

const BOOLEAN_KEYWORDS: Record<string, boolean> = {
  on: true,
  yes: true,
  true: true,
  off: false,
  no: false,
  false: false,
};

export type Func = {
  name: string;
  args: Value[];
};

export type ParseError = {
  data: string;
  col: number;
  message: string;
};

export enum Op {
  Replace,
  Copy,
  Delete,
  Count,
  Extract,
}

export type ParseResult = {
  all: boolean;
  op: Op;
  filters: Func[];
  transforms: Func[];
};

const getOp = (name: string): Op | undefined => {
  switch (name.toLowerCase()) {
    case 'replace':
    case 'set':
      return Op.Replace;
    case 'copy':
    case 'cp':
      return Op.Copy;
    case 'delete':
    case 'remove':
      return Op.Delete;
    case 'count':
      return Op.Count;
    case 'extract':
    case 'separate':
    case 'split':
      return Op.Extract;
    default:
      return undefined;
  }
};

export default class Lexer {
  data: string;
  col: number;

  constructor(data: string) {
    this.data = data.trim();
    this.col = 0;
  }

  eof = () => this.col >= this.data.length;

  /** Throw an error at a specific column. */
  error = (message: string, col?: number): never => {
    throw {
      data: this.data,
      col: col ?? this.col,
      message: message,
    } as ParseError;
  };

  optional = <T>(closure: () => T): { value?: T } => {
    const col = this.col;
    try {
      return { value: closure() };
    } catch {
      this.col = col;
      return {};
    }
  };

  overrideError = <T>(closure: () => T, message: string, col?: number): T => {
    try {
      return closure();
    } catch {
      return this.error(message, col);
    }
  };

  /** Read whitespace, if any. */
  readWhitespace = () => {
    while (!this.eof() && /\s/.test(this.data[this.col])) this.col++;
    return true;
  };

  /** Read at least one bit of whitespace, then some more. */
  readOneWhitespace = () => {
    this.readConstant(/\s/);
    this.readWhitespace();
    return true;
  };

  /** Read an identifier.*/
  readIdentifier = (): string => {
    // read an alphabetical character first
    if (!/[A-Za-z]/.test(this.data[this.col]))
      return this.error(
        'expected an identifier, starting with an alphabet character'
      );

    // continue to read chars
    let buf = this.data[this.col++];
    while (!this.eof() && /[\w?!]/.test(this.data[this.col])) {
      buf += this.data[this.col++];
    }

    return buf;
  };

  readConstant = (match: string | RegExp) => {
    if (typeof match === 'string') {
      if (this.data[this.col] !== match) return this.error('expected ' + match);
    } else {
      if (!match.test(this.data[this.col]))
        return this.error('unexpected character');
    }

    this.col++;
    return true;
  };

  readValue = (): Value => {
    const col = this.col;
    if (/[\d-]/.test(this.data[this.col])) {
      // this is a number
      let buf = this.data[this.col++];
      while (!this.eof() && /[\d.]/.test(this.data[this.col]))
        buf += this.data[this.col++];

      const value = Number(buf);
      if (isNaN(value)) return this.error('invalid number', col);

      const units = this.optional(() => {
        this.readWhitespace();
        return this.readIdentifier();
      });

      return { type: 'number', value, units: units.value };
    } else if (/["']/.test(this.data[this.col])) {
      // a string, contained within quotes
      const quote = this.data[this.col++];
      let escape = false;
      let buf = '';
      while (!this.eof() && !escape && this.data[this.col] !== quote) {
        if (!escape && this.data[this.col] === '\\') escape = true;
        else {
          buf += this.data[this.col];
          escape = false;
        }
        this.col++;
      }

      if (this.eof()) return this.error('string never terminated', col);
      else this.col++;

      return { type: 'string', value: buf };
    } else if (/[A-Za-z]/.test(this.data[this.col])) {
      // a string, but just one word. it could be a function
      const fn = this.optional(() => this.readFunction(true));
      if (fn.value) return { type: 'function', value: fn.value };
      else {
        const ident = this.readIdentifier();
        if (ident.toLowerCase() in BOOLEAN_KEYWORDS)
          return {
            type: 'boolean',
            value: BOOLEAN_KEYWORDS[ident.toLowerCase()],
          };
        return { type: 'string', value: ident };
      }
    } else if (/[<>]/.test(this.data[this.col])) {
      // a one-ended range
      const dir = this.data[this.col++];
      let inclusive = false;
      if (this.data[this.col] === '=') {
        inclusive = true;
        this.col++;
      }

      const num = this.readValue();
      if (num.type !== 'number')
        return this.error('expected a number in the range');

      if (dir === '>')
        return {
          type: 'range',
          min: num.value,
          minEx: !inclusive,
          minUnits: num.units,
        };
      else if (dir === '<')
        return {
          type: 'range',
          max: num.value,
          maxEx: !inclusive,
          maxUnits: num.units,
        };
    }
    return this.error('unknown value', col);
  };

  readFunction = (parensRequired?: boolean): Func => {
    const name = this.readIdentifier();

    if (
      !this.optional(() => {
        this.readWhitespace();
        return this.readConstant('(');
      }).value
    ) {
      if (parensRequired) return this.error('expected (');
      else return { name, args: [] };
    }

    this.readWhitespace();

    const args: Value[] = [];
    let before = false;
    while (!this.eof() && this.data[this.col] !== ')') {
      if (before) {
        this.overrideError(
          () => this.readConstant(','),
          'expected , and another value'
        );
        this.readWhitespace();
      }

      args.push(this.readValue());
      this.readWhitespace();
      before = true;
    }
    this.readConstant(')');

    return { name, args };
  };

  parse(): ParseResult {
    // read filters until we see an operation
    let all = false;
    if (this.data.startsWith('all')) {
      all = true;
      this.readIdentifier();
      this.readWhitespace();
    }

    let filters = [];
    let transformations = [];
    let op: Op;

    while (!this.eof()) {
      const firstWord = this.data.toLowerCase().slice(this.col).match(/^\w+/);
      if (firstWord && getOp(firstWord[0]) !== undefined) {
        op = getOp(firstWord[0]);
        this.readIdentifier();
        if (!this.eof()) this.readOneWhitespace();
        break;
      }

      filters.push(this.readFunction());
      if (this.eof()) break;
      this.readOneWhitespace();
    }

    if (this.eof() && op === undefined) {
      transformations = [...filters];
      filters = [];
      op = Op.Replace;
    }

    while (!this.eof()) {
      transformations.push(this.readFunction());
      const col = this.col;
      this.readWhitespace();
      if (this.eof()) break;
      this.col = col;
      this.readOneWhitespace();
    }

    return {
      all,
      op,
      filters,
      transforms: transformations,
    };
  }
}
