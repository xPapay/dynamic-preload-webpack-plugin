export default {
    '/': require.ensure(['./import-picture'], null, null, 'homepage')
    // '/about': require.ensure(['./blank-file'], null, null, 'aboutpage')
}