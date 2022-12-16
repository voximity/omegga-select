import Lexer, { ParseError, ParseResult } from './lex';
import OmeggaPlugin, { OL, PS, PC } from 'omegga';
import Interpreter from './interpret';

type Config = {
  ['command-authed-roles']: string[];
  ['all-flag-authed-roles']: string[];
};
type Storage = {};

export default class Plugin implements OmeggaPlugin<Config, Storage> {
  omegga: OL;
  config: PC<Config>;
  store: PS<Storage>;

  constructor(omegga: OL, config: PC<Config>, store: PS<Storage>) {
    this.omegga = omegga;
    this.config = config;
    this.store = store;
  }

  parseLine = (speaker: string, line: string): ParseResult | undefined => {
    const lexer = new Lexer(line);
    try {
      return lexer.parse();
    } catch (e) {
      const err = e as ParseError;
      this.omegga.whisper(speaker, '<code>' + err.data + '</>');
      this.omegga.whisper(
        speaker,
        '<color="f00"><code>' + '.'.repeat(err.col) + '^</></>'
      );
      this.omegga.whisper(
        speaker,
        '<color="a00"><b>Error:</b> ' + err.message + '</>'
      );
    }
  };

  isAuthed = (ref: string, roles: readonly string[]) => {
    const list = this.config[ref] ?? [];
    return roles.some((r) => list.includes(r));
  };

  async init() {
    this.omegga.on('cmd:select', async (speaker: string, ...args: string[]) => {
      const player = this.omegga.getPlayer(speaker);

      // assert that the user has permission to use the command
      if (
        !player.isHost() &&
        !this.isAuthed('command-authed-roles', player.getRoles())
      )
        return;

      const result = this.parseLine(speaker, args.join(' '));
      if (result) {
        // assert that the user has permission to use the all flag
        if (
          result.all &&
          !player.isHost() &&
          !this.isAuthed('all-flag-authed-roles', player.getRoles())
        )
          return;

        const interpreter = new Interpreter(result);
        try {
          await interpreter.interpret(this.omegga.getPlayer(speaker));
        } catch (e) {
          this.omegga.whisper(
            speaker,
            `<color="a00"><b>Error:</b> ${e.message}</>`
          );
          console.error(e);
        }
      }
    });

    return { registeredCommands: ['select'] };
  }

  async stop() {}
}
