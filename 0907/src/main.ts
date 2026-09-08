import './ui/style.css';
import { AUDIO } from '@/core/audio';
import { exposeDebugHandles } from '@/core/debug';
import { Game } from '@/game/Game';
import { $ } from '@/ui/UI';

const game = new Game();
exposeDebugHandles(game);

game.boot().catch((err: unknown) => {
  console.error(err);
  const l = $('loader');
  if (l) {
    l.innerHTML =
      '<div class="lg">OOPS</div><div style="color:#ffb3d5;font-size:12px;max-width:80vw;text-align:center">' +
      'Could not start the race.<br>' +
      String((err as Error)?.message ?? err) +
      '</div>';
  }
});

// Mobile browsers suspend the audio graph on interruptions (a call, a lock,
// switching tabs). Nudging it on every pointerdown is cheap and is the only
// reliable way back on iOS.
addEventListener(
  'pointerdown',
  () => {
    AUDIO.init();
    AUDIO.resume();
  },
  { passive: true },
);
