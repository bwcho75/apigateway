var http= require('http');
var redis = require('redis');
var fs = require('fs');

// Constant definition
var PORT=3000;
var REDIS_IP='127.0.0.1';
var REDIS_PORT=6379;
var CONF_FILE="./conf.json";

var CONFIG;
var rclient=redis.createClient(REDIS_PORT,REDIS_IP);    // create redis client
var cnt = 0;
var totalCallCount=0;
function readConfig(filename){
    // read URL routing information from filename
    // and load it into memory
    try {
        data= fs.readFileSync(filename, 'utf8');
        CONFIG = JSON.parse(data);
        //console.log(CONFIG["endpoint"][0]["uri"]);
        //console.log(CONFIG["endpoint"][1]["uri"]);
    }catch(e){
        console.log('Configuration file read error :'+filename);
        console.log(e);
        process.exit(-1);
    }
}

function accessDenied(res,msg){
    res.writeHead(403);
    res.write("Access denied :"+msg);
    res.end();
}
// api gateway server main function
var server = http.createServer(function(req,res) {

    var method = req.method; // get http method
    var uri = req.url.split('?')[0]; // requested HTTP URI. it removes query string from URI

    var apikey;              // apikey string from API client
    var apikeyMeta;
    var config;
    var endpoint = null;

    // Based on URL, it finds the registered end point in configuration file
    for (var i = 0; i < CONFIG['endpoint'].length; i++) {
        config = CONFIG['endpoint'][i];
        reg = '^' + config['uri'];
        if (uri.match(reg)) {
            // found endpoint
            endpoint = config;
            break;
        }
    }
    if(endpoint == null){
        accessDenied(res,"not defined endpoint");
        return;
    }

    // Retrieve API key from HTTP request
    // based on "auth" in endpoint configuration, the token will be extracted from HTTP Header or Cookie etc.
    var tokenTypes = config['auth'];
    for (i = 0; i < tokenTypes.length; i++) {
        console.log("Token types:"+tokenTypes[i]);
        if (tokenTypes[i] == 'web') {
            // ★★★★★★★★★★★★★★
            // 쿠키에서 토큰 읽어오는 부분 추가 필요
            break;

        } else if (tokenTypes[i] == 'device') {
            apikey = req.headers['x-api-apikey'];
            if(apikey != null) break;
        } else if(tokenTypes[i]  == 'server') {
            // ★★★★★★★★★★★★★★
            // 서버 토큰 처리 필요
            break;

        }
    }

    // Look up api key from key table
    rclient.get(apikey,function(err,reply){
        if(reply == null){
            accessDenied(res,"Token is not registered");
            return;
        }else{

            // Found the token
            apikeyMeta = JSON.parse(reply);
            //console.log(apikeyMeta);

            // config 파일에서 지원하는 서비스 종류와, 토큰으로 접근이 가능한 서비스 인지 확인할것
            apiServiceIds = apikeyMeta['serviceId'];
            serviceAllowed=false;
            if(endpoint['service'].indexOf('*')!=-1) {
                // if this end point support all service, it will be skipped.
                serviceAllowed = true;
            }else{
                for (i = 0; i < apiServiceIds.length; i++) {
                    if (endpoint['service'].indexOf(apiServiceIds[i]) != -1) {
                        serviceAllowed = true;
                        break;
                    }//if
                }// for
            }
            // 만약에 apikey와 연동된 serviceid들이 endpoint에 의해서 지원이 되지 않는 경우
            if(!serviceAllowed){
                accessDenied(res,"This token doesn't have a service access authority to access this endpoint");
                return;
            }else {
                apiServer= endpoint['serverlist'][cnt];
                apiServerIp = apiServer.split(':')[0];
                apiServerPort = apiServer.split(':')[1];
                apiPath = uri.substring(uri.split('/')[1].length+1,uri.length)
                if(++cnt >= endpoint['serverlist'].length ) cnt=0;

                //console.log(apiServer);
                console.log(totalCallCount++);
                // create proxy connection
                // Pipe lining API server
                var options = {
                    host:apiServerIp ,
                    port:apiServerPort,
                    path:apiPath,
                    method:method,
                    headers:{
                        "x-api-userid":apikeyMeta['userId'],
                        "x-api-tenantId":apikeyMeta['tenantId'],
                        "x-api-role":apikeyMeta['role'],
                        "x-api-serviceId":apikeyMeta['serviceId']
                    }
                };

                //populate header

                http.request(options,function(apiResponse){
                   apiResponse.pipe(res);
                   // 원래 res에 대해서 end는 언제 하지? 안해도 잘 되네..
                }).end();
            }
        }
    });
    // compare key type
    // route to server
});


// read routing table
// 먼저 파일에서 라우팅 테이블을 읽어온다.
readConfig(CONF_FILE);
// run gateway server
server.listen(PORT);
