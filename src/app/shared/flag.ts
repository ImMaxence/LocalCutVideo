import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input } from '@angular/core';

let uid = 0;

const svg = (width: number, height: number, body: string) =>
  `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
const n = (value: number) => +value.toFixed(3);

/** Horizontal bands in a 3×2 box, top to bottom, of equal height unless weighted. */
function rows(colors: string[], weights = colors.map(() => 1)): string {
  const total = weights.reduce((a, b) => a + b, 0);
  let y = 0;
  return colors
    .map((color, i) => {
      const height = (2 * weights[i]) / total;
      const band = `<path fill="${color}" d="M0 ${n(y)}h3v${n(height)}H0z"/>`;
      y += height;
      return band;
    })
    .join('');
}

/** Three vertical bands in a 3×2 box. */
const cols = (...colors: string[]) => colors.map((color, i) => `<path fill="${color}" d="M${i} 0h1v2H${i}z"/>`).join('');

/** Star path with `points` points, the first one turned `turn` degrees clockwise from the top. */
function star(cx: number, cy: number, radius: number, points = 5, inner = 0.382, turn = 0): string {
  const corners = Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? radius * inner : radius;
    const angle = ((turn - 90 + (i * 180) / points) * Math.PI) / 180;
    return `${n(cx + r * Math.cos(angle))} ${n(cy + r * Math.sin(angle))}`;
  });
  return `M${corners.join('L')}Z`;
}

/** Croatian checkerboard: red squares over a white shield. */
function checker(x: number, y: number, size: number, columns: number, lines: number): string {
  let d = '';
  for (let row = 0; row < lines; row++) {
    for (let col = row % 2; col < columns; col += 2) d += `M${n(x + col * size)} ${n(y + row * size)}h${size}v${size}h-${size}z`;
  }
  return d;
}

const KOREA_BARS = 'M6.2 9.5h.7v5h-.7zM7.4 9.5h.7v5h-.7zM8.6 9.5h.7v5h-.7zM26.7 9.5h.7v5h-.7zM27.9 9.5h.7v5h-.7zM29.1 9.5h.7v5h-.7z';
const CHINA_SMALL_STARS = [
  [10, 2],
  [12, 4],
  [12, 7],
  [10, 9],
]
  // Each small star points at the big one.
  .map(([x, y]) => `<path d="${star(x, y, 1, 5, 0.382, (Math.atan2(5 - y, 5 - x) * 180) / Math.PI + 90)}"/>`)
  .join('');

/** Simplified flags, by country code (ISO 3166-1). Static markup built from constants only. */
const FLAGS: Record<string, string> = {
  fr: svg(3, 2, cols('#0055A4', '#fff', '#EF4135')),
  it: svg(3, 2, cols('#009246', '#fff', '#CE2B37')),
  ro: svg(3, 2, cols('#002B7F', '#FCD116', '#CE1126')),
  de: svg(3, 2, rows(['#000', '#DD0000', '#FFCE00'])),
  es: svg(3, 2, rows(['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1])),
  pt: svg(5, 3, '<path fill="#046A38" d="M0 0h2v3H0z"/><path fill="#DA291C" d="M2 0h3v3H2z"/><circle cx="2" cy="1.5" r=".6" fill="#FFE900"/>'),
  br: svg(
    10,
    7,
    '<path fill="#009C3B" d="M0 0h10v7H0z"/><path fill="#FFDF00" d="M5 .7 9.3 3.5 5 6.3.7 3.5z"/><circle cx="5" cy="3.5" r="1.75" fill="#002776"/><path fill="none" stroke="#fff" stroke-width=".25" d="M3.3 3.1c1.2-.3 2.5-.1 3.4.6"/>',
  ),
  nl: svg(3, 2, rows(['#AE1C28', '#fff', '#21468B'])),
  se: svg(16, 10, '<path fill="#006AA7" d="M0 0h16v10H0z"/><path fill="#FECC02" d="M5 0h2v10H5zM0 4h16v2H0z"/>'),
  dk: svg(37, 28, '<path fill="#C8102E" d="M0 0h37v28H0z"/><path fill="#fff" d="M12 0h4v28h-4zM0 12h37v4H0z"/>'),
  no: svg(22, 16, '<path fill="#BA0C2F" d="M0 0h22v16H0z"/><path fill="#fff" d="M6 0h4v16H6zM0 6h22v4H0z"/><path fill="#00205B" d="M7 0h2v16H7zM0 7h22v2H0z"/>'),
  fi: svg(18, 11, '<path fill="#fff" d="M0 0h18v11H0z"/><path fill="#002F6C" d="M5 0h3v11H5zM0 4h18v3H0z"/>'),
  ee: svg(3, 2, rows(['#0072CE', '#000', '#fff'])),
  lv: svg(3, 2, rows(['#9E3039', '#fff', '#9E3039'], [2, 1, 2])),
  lt: svg(3, 2, rows(['#FDB913', '#006A44', '#C1272D'])),
  pl: svg(3, 2, rows(['#fff', '#DC143C'])),
  cz: svg(3, 2, rows(['#fff', '#D7141A']) + '<path fill="#11457E" d="M0 0l1.5 1L0 2z"/>'),
  sk: svg(
    3,
    2,
    rows(['#fff', '#0B4EA2', '#EE1C25']) +
      '<path fill="#fff" d="M.62 .45h.66v.75c0 .3-.2.45-.33.55-.13-.1-.33-.25-.33-.55z"/><path fill="#EE1C25" d="M.66 .49h.58v.7c0 .27-.17.4-.29.49-.12-.09-.29-.22-.29-.49z"/><path fill="#fff" d="M.92 .58h.06v.75h-.06zM.82 .72h.26v.06H.82zM.78 .88h.34v.06H.78z"/><path fill="#0B4EA2" d="M.7 1.35a.1.1 0 0 1 .5 0c-.05.12-.15.2-.25.27-.1-.07-.2-.15-.25-.27z"/>',
  ),
  hu: svg(3, 2, rows(['#CE2939', '#fff', '#477050'])),
  bg: svg(3, 2, rows(['#fff', '#00966E', '#D62612'])),
  gr: svg(
    27,
    18,
    '<path fill="#0D5EAF" d="M0 0h27v18H0z"/><path fill="#fff" d="M10 2h17v2H10zM10 6h17v2H10zM0 10h27v2H0zM0 14h27v2H0zM4 0h2v10H4zM0 4h10v2H0z"/>',
  ),
  hr: svg(
    3,
    2,
    rows(['#FF0000', '#fff', '#171796']) +
      `<path fill="#fff" d="M1.3 .55h.4v.5a.2.2 0 0 1-.4 0z"/><path fill="#FF0000" d="${checker(1.3, 0.55, 0.1, 4, 6)}"/>`,
  ),
  rs: svg(
    3,
    2,
    rows(['#C6363C', '#0C4076', '#fff']) +
      '<path fill="#EDB92E" d="M.76 .4h.32l-.03.08H.79z"/><path fill="#C6363C" stroke="#EDB92E" stroke-width=".03" d="M.72 .5h.4v.5c0 .2-.13.3-.2.36-.07-.06-.2-.16-.2-.36z"/><path fill="#fff" d="M.9 .56h.04v.68H.9zM.78 .76h.28v.04H.78z"/>',
  ),
  si: svg(
    3,
    2,
    rows(['#fff', '#003DA5', '#ED1C24']) +
      '<path fill="#003DA5" stroke="#ED1C24" stroke-width=".03" d="M.55 .35h.45v.45c0 .2-.13.3-.225.37-.1-.07-.225-.17-.225-.37z"/><path fill="#fff" d="M.6 .78l.1-.12.075.08.075-.08.1.12c-.03.1-.1.17-.175.22-.08-.05-.15-.12-.175-.22z"/><path fill="#FFDD00" d="M.66 .45h.04v.04h-.04zM.76 .45h.04v.04h-.04zM.71 .52h.04v.04h-.04z"/>',
  ),
  ua: svg(3, 2, rows(['#0057B7', '#FFD700'])),
  ru: svg(3, 2, rows(['#fff', '#0039A6', '#D52B1E'])),
  tr: svg(
    30,
    20,
    `<path fill="#E30A17" d="M0 0h30v20H0z"/><circle cx="10.5" cy="10" r="5" fill="#fff"/><circle cx="11.75" cy="10" r="4" fill="#E30A17"/><path fill="#fff" d="${star(17, 10, 2.5, 5, 0.382, -90)}"/>`,
  ),
  sa: svg(
    30,
    20,
    '<path fill="#006C35" d="M0 0h30v20H0z"/><path fill="none" stroke="#fff" stroke-width=".9" stroke-linecap="round" d="M8 9.5c1-1.6 2 .8 3.2-.6s2-1 3 0 2.2.8 3.2-.8 2 .6 3.2.2 1-1.6 1.4-1.6"/><path fill="#fff" d="M8.5 13h12.5l1.2.5-1.2.5H8.5z"/>',
  ),
  il: svg(
    22,
    16,
    '<path fill="#fff" d="M0 0h22v16H0z"/><path fill="#0038B8" d="M0 1.5h22V4H0zM0 12h22v2.5H0z"/><path fill="none" stroke="#0038B8" stroke-width=".55" d="M11 5.1l2.5 4.3h-5zM11 10.9l-2.5-4.3h5z"/>',
  ),
  ir: svg(
    3,
    2,
    rows(['#239F40', '#fff', '#DA0000']) +
      '<path fill="#DA0000" d="M1.47 .78h.06v.44h-.06z"/><path fill="none" stroke="#DA0000" stroke-width=".04" d="M1.38 .82c-.06.14 0 .3.12.34M1.62 .82c.06.14 0 .3-.12.34"/>',
  ),
  jp: svg(3, 2, '<path fill="#fff" d="M0 0h3v2H0z"/><circle cx="1.5" cy="1" r=".6" fill="#BC002D"/>'),
  kr: svg(
    36,
    24,
    `<path fill="#fff" d="M0 0h36v24H0z"/><g transform="rotate(33.69 18 12)"><circle cx="18" cy="12" r="6" fill="#0047A0"/><path fill="#CD2E3A" d="M12 12a6 6 0 0 1 12 0 3 3 0 0 1-6 0 3 3 0 0 0-6 0z"/><path d="${KOREA_BARS}"/></g><path transform="rotate(-33.69 18 12)" d="${KOREA_BARS}"/>`,
  ),
  cn: svg(30, 20, `<path fill="#EE1C25" d="M0 0h30v20H0z"/><g fill="#FFFF00"><path d="${star(5, 5, 3)}"/>${CHINA_SMALL_STARS}</g>`),
  tw: svg(
    30,
    20,
    `<path fill="#FE0000" d="M0 0h30v20H0z"/><path fill="#000095" d="M0 0h15v10H0z"/><path fill="#fff" d="${star(7.5, 5, 3.75, 12, 0.55)}"/><circle cx="7.5" cy="5" r="2.1" fill="#000095"/><circle cx="7.5" cy="5" r="1.8" fill="#fff"/>`,
  ),
  in: svg(
    3,
    2,
    rows(['#FF9933', '#fff', '#138808']) +
      '<circle cx="1.5" cy="1" r=".27" fill="none" stroke="#000080" stroke-width=".05"/><circle cx="1.5" cy="1" r=".06" fill="#000080"/>',
  ),
  bd: svg(10, 6, '<path fill="#006A4E" d="M0 0h10v6H0z"/><circle cx="4.5" cy="3" r="2" fill="#F42A41"/>'),
  pk: svg(
    30,
    20,
    `<path fill="#fff" d="M0 0h30v20H0z"/><path fill="#01411C" d="M7.5 0H30v20H7.5z"/><circle cx="19" cy="10" r="5.6" fill="#fff"/><circle cx="20.4" cy="8.7" r="5" fill="#01411C"/><path fill="#fff" d="${star(22.3, 7.2, 1.9, 5, 0.382, 30)}"/>`,
  ),
  id: svg(3, 2, rows(['#CE1126', '#fff'])),
  my: svg(
    28,
    14,
    `<path fill="#fff" d="M0 0h28v14H0z"/><path fill="#CC0001" d="${Array.from({ length: 7 }, (_, i) => `M0 ${i * 2}h28v1H0z`).join('')}"/><path fill="#010066" d="M0 0h14v8H0z"/><circle cx="5.7" cy="4" r="3" fill="#FC0"/><circle cx="6.6" cy="4" r="2.5" fill="#010066"/><path fill="#FC0" d="${star(10.3, 4, 2.1, 14, 0.45)}"/>`,
  ),
  th: svg(3, 2, rows(['#A51931', '#F4F5F8', '#2D2A4A', '#F4F5F8', '#A51931'], [1, 1, 2, 1, 1])),
  vn: svg(30, 20, `<path fill="#DA251D" d="M0 0h30v20H0z"/><path fill="#FF0" d="${star(15, 10, 6)}"/>`),
  ph: svg(
    20,
    10,
    `<path fill="#0038A8" d="M0 0h20v5H0z"/><path fill="#CE1126" d="M0 5h20v5H0z"/><path fill="#fff" d="M0 0l8.66 5L0 10z"/><g fill="#FCD116"><path d="${star(2.9, 5, 1.3, 8, 0.45)}"/><circle cx="2.9" cy="5" r=".55"/><path d="${star(0.95, 1.3, 0.38)}"/><path d="${star(0.95, 8.7, 0.38)}"/><path d="${star(7.1, 5, 0.38)}"/></g>`,
  ),
  tz: svg(
    72,
    48,
    '<path fill="#1EB53A" d="M0 48V0h72z"/><path fill="#00A3DD" d="M72 0v48H0z"/><path fill="none" stroke="#FCD116" stroke-width="19" d="M-10 54.67 82-6.67"/><path fill="none" stroke="#000" stroke-width="13" d="M-10 54.67 82-6.67"/>',
  ),
};

/** Inline SVG flags (Windows does not render flag emojis). Static markup only. */
function flagSvg(code: string, id: string): string {
  // United Kingdom by default (English); its clip paths need ids unique in the page.
  return (
    FLAGS[code] ??
    `<svg viewBox="0 0 60 30" preserveAspectRatio="xMidYMid slice"><clipPath id="${id}s"><path d="M0 0v30h60V0z"/></clipPath><clipPath id="${id}t"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath><g clip-path="url(#${id}s)"><path d="M0 0v30h60V0z" fill="#012169"/><path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/><path d="M0 0l60 30m0-30L0 30" clip-path="url(#${id}t)" stroke="#C8102E" stroke-width="4"/><path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/><path d="M30 0v30M0 15h60" stroke="#C8102E" stroke-width="6"/></g></svg>`
  );
}

@Component({
  selector: 'app-flag',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', class: 'flag' },
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 20px;
      height: 14px;
      border-radius: 3px;
      overflow: hidden;
      box-shadow: 0 0 0 1px light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.16));
    }
    :host ::ng-deep svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  `,
})
export class Flag {
  readonly code = input.required<string>();
  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly id = `flag${++uid}`;

  constructor() {
    effect(() => {
      // The SVG markup is built from constants only, never from user input.
      this.el.nativeElement.innerHTML = flagSvg(this.code(), this.id);
    });
  }
}
