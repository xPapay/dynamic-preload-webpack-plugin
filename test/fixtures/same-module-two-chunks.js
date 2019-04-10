export default {
    '/': require.ensure(['./homepage.js'], null, null, 'homepage'),
    '/about': require.ensure(['./aboutpage.js'], null, null, 'aboutpage')
}