export function generateUsername() {
    const words = [
      ['mapache', 'capibara', 'flan', 'taco', 'pato', 'gato', 'pulpo', 'kiwi', 'nugget', 'queso', 'churro', 'duende', 'pepino', 'pinguino', 'aguacate', 'cactus', 'panda', 'robot', 'yeti', 'mango', 'banano', 'burrito', 'gnomo', 'dragon', 'conejo', 'waffle', 'nacho', 'tamal', 'coco', 'pollo', 'erizo', 'mochi'],
      ['ninja', 'cosmico', 'pirata', 'zombi', 'travieso', 'dramatico', 'galactico', 'bailarin', 'chismoso', 'distraido', 'dormilon', 'picante', 'rebelde', 'mistico', 'electrico', 'supremo', 'torpe', 'veloz', 'zen', 'salvaje', 'millonario', 'espacial', 'invisible', 'tropical', 'filosofo', 'mafioso', 'volador', 'legendario', 'divino', 'cantarin', 'furtivo', 'elegante'],
      ['delcaos', 'delwifi', 'delpan', 'delmar', 'delcafe', 'delcosmos', 'delbarrio', 'delsofa', 'delte', 'delmeme', 'delparque', 'delmetro', 'delclub', 'delbosque', 'delrio', 'delbar', 'sinprisa', 'sinmapa', 'sinsueno', 'sinplan', 'conflow', 'conestilo', 'conhambre', 'conpijama', 'enpatines', 'enorbita', 'enfiesta', 'envacacion', 'debolsillo', 'deguardia', 'deincognito', 'delviernes']
    ];
    const random = crypto.getRandomValues(new Uint8Array(words.length));
    return words.map((list, index) => list[random[index] & 31]).join('');
  }
export function generatePassword() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@';
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => alphabet[byte & 63]).join('');
  }
