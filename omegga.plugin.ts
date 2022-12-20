import Lexer, { ParseError, ParseResult } from './lex';
import OmeggaPlugin, { OL, PS, PC } from 'omegga';
import Interpreter, { SaveBackup } from './interpret';

type Config = {
  ['create-backups']: boolean;
  ['command-authed-roles']: string[];
  ['all-flag-authed-roles']: string[];
};
type Storage = {};

export const backups: Record<string, SaveBackup> = {};

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
    const confirms: Record<string, () => void> = {};

    const command = async (speaker: string, ...args: string[]) => {
      console.log(speaker, 'is running /select', ...args);

      const player = this.omegga.getPlayer(speaker);
      if (confirms[player.id]) {
        if (args.join(' ') === 'ok') {
          this.omegga.whisper(player, 'OK, proceeding...');
          confirms[player.id]();
        } else {
          this.omegga.whisper(player, 'Action cancelled.');
          delete confirms[player.id];
        }
        return;
      }

      // assert that the user has permission to use the command
      if (
        !player.isHost() &&
        !this.isAuthed('command-authed-roles', player.getRoles())
      )
        return this.omegga.whisper(
          player,
          '<color="f00">Permission denied.</> You are not authorized to use the select command.'
        );

      const result = this.parseLine(speaker, args.join(' '));
      if (result) {
        // assert that the user has permission to use the all flag
        if (
          result.all &&
          !player.isHost() &&
          !this.isAuthed('all-flag-authed-roles', player.getRoles())
        )
          return this.omegga.whisper(
            player,
            '<color="f00">Permission denied.</> You are not authorized to use the <code>all</> flag.'
          );

        if (result.all) {
          this.omegga.whisper(
            player,
            '<color="f80"><b>Warning:</></> Using <code>all</> is a potentially destructive action.'
          );
          this.omegga.whisper(
            player,
            'If you wish to <color="0f0">confirm</>, use <code>/select ok</>. Otherwise, run <code>/select [anything]</> or wait.'
          );

          try {
            await new Promise<void>((resolve, reject) => {
              const cleanup = () => {
                delete confirms[player.id];
              };
              const timeout = setTimeout(() => {
                cleanup();
                reject('timed_out');
              }, 30_000);
              confirms[player.id] = () => {
                clearTimeout(timeout);
                cleanup();
                resolve();
              };
            });
          } catch {}
        }

        const interpreter = new Interpreter(result);
        try {
          await interpreter.interpret(this, this.omegga.getPlayer(speaker));
        } catch (e) {
          this.omegga.whisper(
            speaker,
            `<color="a00"><b>Error:</b> ${e.message}</>`
          );
          console.error(e);
        }
      }
    };

    this.omegga.on('cmd:select', command);
    this.omegga.on('chatcmd:select', command);

    this.omegga.on('cmd:selectundo', async (speaker: string) => {
      const player = this.omegga.getPlayer(speaker);

      // assert that the user has permission to use the command
      if (
        !player.isHost() &&
        !this.isAuthed('command-authed-roles', player.getRoles())
      )
        return this.omegga.whisper(
          player,
          '<color="f00">Permission denied.</> You are not authorized to use the select command.'
        );

      if (!this.config['create-backups'])
        return this.omegga.whisper(
          player,
          '<color="f00">Backups are not enabled.</> Please enable them in the configuration first.'
        );

      if (!(player.id in backups))
        return this.omegga.whisper(player, `<color="f00">No backup found.</>`);

      const backup = backups[player.id];
      delete backups[player.id];

      console.log(player.name, 'restoring backup');
      this.omegga.whisper(player, 'Restoring...');
      if (backup.bounds)
        this.omegga.clearRegion({
          center: backup.bounds.center,
          extent: backup.bounds.maxBound.map(
            (c, i) => c - backup.bounds.center[i]
          ) as [number, number, number],
        });
      else this.omegga.clearAllBricks(true);

      await this.omegga.loadSaveData(backup.data, { quiet: true });
      this.omegga.whisper(player, 'Backup restored.');
    });

    const ln2srgb = (c: number) =>
      c > 0.0031308 ? 1.055 * Math.pow(c, 1.0 / 2.4) - 0.055 : 12.92 * c;

    this.omegga.on('cmd:getcolor', async (speaker: string) => {
      const player = this.omegga.getPlayer(speaker);
      const paint = await player.getPaint();
      const displayColor = paint.color.map((n) =>
        Math.round(ln2srgb(n / 255) * 255)
      );
      this.omegga.whisper(
        player,
        `<color="${displayColor
          .map((c) => c.toString(16).padStart(2, '0'))
          .join('')}">Selected color:</> (${paint.color
          .map(
            (c, i) =>
              `<color="${
                i === 0 ? displayColor[i].toString(16).padStart(2, '0') : '00'
              }${
                i === 1 ? displayColor[i].toString(16).padStart(2, '0') : '00'
              }${
                i === 2 ? displayColor[i].toString(16).padStart(2, '0') : '00'
              }">#</>${c}`
          )
          .join(', ')})`
      );
    });

    this.omegga.on('leave', (player) => {
      if (player.id in backups) delete backups[player.id];
    });

    return { registeredCommands: ['select', 'selectundo', 'getcolor'] };
  }

  async stop() {}
}
