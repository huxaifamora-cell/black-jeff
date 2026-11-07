// The symbols SORK monitors (Deriv synthetic indices). Codes are resolved from Deriv by display name.
export const WANTED = [
  'Volatility 10 Index', 'Volatility 15 Index', 'Volatility 25 Index', 'Volatility 30 Index',
  'Volatility 50 Index', 'Volatility 75 Index', 'Volatility 90 Index', 'Volatility 100 Index',
  'Volatility 150 Index', 'Volatility 250 Index',
  'Volatility 5 (1s) Index', 'Volatility 10 (1s) Index', 'Volatility 15 (1s) Index',
  'Volatility 25 (1s) Index', 'Volatility 30 (1s) Index', 'Volatility 50 (1s) Index',
  'Volatility 75 (1s) Index', 'Volatility 90 (1s) Index', 'Volatility 100 (1s) Index',
  'Volatility 150 (1s) Index', 'Volatility 200 (1s) Index', 'Volatility 250 (1s) Index',
  'Volatility 300 (1s) Index',
];

export function slug(name) {
  const m = /^Volatility (\d+)( \(1s\))? Index$/.exec(name);
  return `V${m[1]}${m[2] ? 's' : ''}`;
}

export const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export const SYMBOLS = WANTED.map((n) => ({
  id: slug(n), name: n, short: n.replace('Volatility ', 'V').replace(' Index', ''),
}));
