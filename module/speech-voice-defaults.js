/** Public Fish voice presets mapped to the game's registered NPC IDs; saved bindings take precedence. */
var speechVoiceDefaults = (function () {
    'use strict';
    var ids=Object.freeze({
        A:'b6e44b2400a84a2d82ac006b2718aeb1', // 破阵子
        B:'2e86853070c844bf98c37c55ca597844', // 洞庭君
        C:'2e801eb2ed5c442da7763ff17df83bff', // 钱塘君
        D:'bd6f7862753f46908ac19b19ba84eb3c', // 萧白瑚
        E:'085f3ff87ada45db94f3bd316f070f15', // 姬姒
        F:'b49bda63a3704dbaad59b0fb3d330dd1', // 施延年
        G:'b5e3eb9d3cbc4c558304ad023147406a', // 呼延显
        H:'e2bd626e3f364c0c914892dc082c8d79', // 雨烛
        I:'4ca68a299cb24ae599dbb828dc31a73c', // 安慕
        J:'cab93dd5e1684a648dbfde02bff2c0dc', // 唐沐梨
        K:'c14735df6db74fdea7c92d7d09f47ff6', // 洛潜幽
        M:'80a4bf8f7d5849fa93663dbaae86ebc9', // 玄天青
        N:'8e80c3dcdf894213a10b48e9b08ad8c6', // 鹿椿若
        O:'c69f8376aa3c41fc9f7f17367562d9b6'  // 苓雪妃
    });
    function create(){var out={};Object.keys(ids).forEach(function(id){out[id]={kind:'fish-drama3',speakerId:ids[id],version:'1'};});return out;}
    return Object.freeze({create:create});
})();
