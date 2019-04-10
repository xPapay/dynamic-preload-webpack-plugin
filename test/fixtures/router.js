export default {
    '/': require.ensure(['./import-picture'], null, null, 'homepage')
}
