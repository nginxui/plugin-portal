module.exports = {
  input: {
    path: './web/src',
    include: ['**/*.ts', '**/*.vue'],
  },
  output: {
    path: './web/src/language',
    locales: ['zh_CN'],
    flat: true,
    linguas: false,
    locations: false,
    fuzzyMatching: false,
  },
}
