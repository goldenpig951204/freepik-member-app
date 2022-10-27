const querystring = require("querystring");
const cheerio = require("cheerio");
const settingModel = require("../models/setting");
const freepikOverview = require("../models/freepikOverview");

const utils = require("../services/normalHelpers");
const webClient = require("../services/clientHelpers").create(true);
const handlerHelpers = require("../services/handleHelpers");
const FormData = require("form-data");
const { JSON_to_URLEncoded } = require("../services/utils");

const SERVICE_MAIN_DOMAIN = "www.freepik.com";
const SERVICE_ROOT_DOMAIN = "freepik.com";
const internals = {};
let currentDomain = "";
module.exports = async function (request, reply) {
    currentDomain = request.headers["host"];

    let targetedUrl = request.url;
    let targetedHost = SERVICE_MAIN_DOMAIN;
    let portNumber = 443;
    let refererUrl = "";

    if (typeof request.headers["referer"] !== "undefined") {
        refererUrl = handlerHelpers.getRealReferer(targetedHost, currentDomain, request.headers["referer"]);
    }

    if (handlerHelpers.urlContainsOriginalHost(request.url)) {
        targetedUrl = handlerHelpers.removeOriginalHost(request.url);
        targetedHost = handlerHelpers.extractOriginalHost(request.url);
        if (handlerHelpers.containsPortNumber(targetedHost)) {
            portNumber = handlerHelpers.extractPortNumber(targetedHost);
            targetedHost = handlerHelpers.stripPortNumber(targetedHost);
        }
    } else {
        if (handlerHelpers.urlContainsOriginalHost(request.headers["referer"] + "")) {
            targetedHost = handlerHelpers.extractOriginalHost(request.headers["referer"] + "");
        }
    }

    const realFullUrl = "https://" + targetedHost + targetedUrl;
    const requestFullUrl = "https://" + currentDomain + request.url;

    const serviceDomainRegExp = new RegExp(SERVICE_ROOT_DOMAIN.replace(/\./, "\."));

    //we get current user only for non static resources
    if (!utils.isStaticRes(request.url)) {

        if (serviceDomainRegExp.test(targetedHost)) {

            if (typeof request.user !== "object") {
                return reply.send("Please connect");
            } else {
                if (!request.user.isAdmin && internals.isForbiddenUrl(request.url)) {
                    reply.header("location", "/");
                    return reply.status(302).send("Redirecting...");
                }
            }
        }
    }


    const excludedHeaders = [
        "cookie", "user-agent", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
        "sec-fetch-user", "upgrade-insecure-requests", "host",
        "connection", "pragma", "accept-language", "accept-encoding"
    ];

    const someHeadersValue = {
        "origin": "https://" + SERVICE_MAIN_DOMAIN,
        "referer": refererUrl
    };

    const allowedRequestHeaders = handlerHelpers.filterRequestHeaders(request.headers, excludedHeaders, someHeadersValue);
    if (typeof request.headers["origin"] !== "undefined") {
        allowedRequestHeaders["origin"] = "https://" + SERVICE_MAIN_DOMAIN;
    }



    allowedRequestHeaders["user-agent"] = utils.randomUserAgent(0);

    allowedRequestHeaders["cookie"] = request.proxy.cookie;

    let requestData = "";
    if (/post|put|patch/i.test(request.method)) {
        if (request.method === 'POST') {
            if (/multipart\/form-data/i.test(request.headers['content-type'])) {
                const parts = (request.headers['content-type'] + '').split(/boundary=/);
                const boundary = parts[1];

                const form = new FormData();
                form.setBoundary(boundary);
                for (let name in request.body) {
                    form.append(name, request.body[name]);
                }
                requestData = form.getBuffer().toString('utf8');
            } else if (/application\/json/i.test(request.headers['content-type'])) {
                requestData = JSON.stringify(request.body);
            } else if (/application\/x-www-form-urlencoded/i.test(request.headers['content-type'])) {
                requestData = JSON_to_URLEncoded(request.body);
            } else {
                requestData = request.body;
            }
        }
        if (typeof requestData === "string") {
            const domainRegExp = new RegExp(currentDomain, "mg");
            const encodedDomainRegExp = new RegExp(currentDomain, "mg");
            const mcoppRegExp = new RegExp(querystring.escape('__mcopp="1"'), "mg");

            requestData = requestData.replace(domainRegExp, targetedHost).replace(new RegExp(handlerHelpers.MCOP_LOCATION_STR, 'mg'), "location");
            requestData = requestData.replace(domainRegExp, targetedHost);
            requestData = requestData.replace(encodedDomainRegExp, targetedHost);
            requestData = requestData.replace(mcoppRegExp, '');
            allowedRequestHeaders["content-length"] = Buffer.byteLength(requestData);
        }
    }
    if (/\/xhr\/validate/.test(request.path)) {
        let { id, username, isAdmin } = request.user;
        let wpSite = request.wpSite;
        dailyLimit = await settingModel.getOverviewLimit("freepikDownloadLimit");
        currentLimit = await freepikOverview.countRequests(id, username, wpSite, "freepik");
        if (dailyLimit > currentLimit) {
            await freepikOverview.create({
                userId: id,
                username: username,
                site: wpSite,
                proxyType: "freepik"
            });
            // return reply.json({
            //     countDownloads:currentLimit,
            //     limitDownloads:100,
            //     isManual:true,
            //     userSuspected:false,
            //     cerberusBanGALimit:false,
            //     cerberusPasswordAlreadyChanged:false,
            //     cerberusPasswordChangedTimestamp:1666809678,
            //     redirectTo429LimitExceeded:false
            // });
        } else {
            return reply.json({
                // countDownloads:100,
                // limitDownloads:100,
                // isManual:false,
                // userSuspected:false,
                // cerberusBanGALimit:false,
                // cerberusPasswordAlreadyChanged:false,
                // cerberusPasswordChangedTimestamp:1666809678,
                redirectTo429LimitExceeded:true
            });
        }
    }
    let serverRes = undefined;

    const threeMinutes = 180000;
    webClient.setTimeout(threeMinutes);
    webClient.acceptUnverifiedSslCertificates();

    if (typeof portNumber !== "undefined")
        webClient.setPort(portNumber);

    //Send request to remote server as a client
    await webClient.sendRequest(request.method, targetedHost, targetedUrl, allowedRequestHeaders, requestData).then(function (serverResponse) {
        serverRes = serverResponse;
    });

    let body = "";
    let receivedData = serverRes.body;
    const statusCode = serverRes.statusCode;

    const headersToBlock = [
        "set-cookie", "content-encoding", "access-control-allow-origin", "content-security-policy",
        "transfer-encoding", "content-security-policy-report-only", "x-frame-options"
    ];
    let regExpStr = "";
    const lastIndex = headersToBlock.length - 1;
    for (let i = 0; i < headersToBlock.length; i++) {
        if (i < lastIndex) {
            regExpStr += headersToBlock[i] + "|";
        } else {
            regExpStr += headersToBlock[i];
        }
    }

    const skippedHeaderRegExp = new RegExp(regExpStr);
    for (let name in serverRes.headers) {
        if (! skippedHeaderRegExp.test(name + "")) {
            reply.header(name, serverRes.headers[name]);
        }
    }

    if (typeof serverRes.headers["location"] !== "undefined") {
        let redirectUrl = serverRes.headers["location"];
        if (/^\//.test(redirectUrl)) {
            redirectUrl = `https://${targetedHost}${redirectUrl}`;
        }
        const newLocation = handlerHelpers.modifyUrl(redirectUrl, currentDomain);

        reply.header("location", newLocation);
        reply.status(statusCode);
        return reply.send("Redirection...");
    }

    let isEncoded = false;
    body = Buffer.concat(receivedData);

    if (handlerHelpers.shouldBeDecompressed(serverRes.headers['content-type'])) {
        if (receivedData.length > 0) {
            if (/gzip/i.test(serverRes.headers['content-encoding'] + "")) {
                body = await utils.gunzip(body);
                isEncoded = true;
            } else if (/deflate/i.test(serverRes.headers['content-encoding'] + "")) {
                body = await utils.inflate(body);
                isEncoded = true;
            } else if (/br/i.test(serverRes.headers['content-encoding'] + "")) {
                body = await utils.brotliDecompress(body);
                isEncoded = true;
            }
        }
    } else {
        if (typeof serverRes.headers['content-encoding'] !== 'undefined')
            reply.header('content-encoding', serverRes.headers['content-encoding']);
    }

    if (handlerHelpers.isHtml(serverRes.headers["content-type"])) {
        body = body.toString("utf-8");
        if (body.length > 0) {
            body = handlerHelpers.injectPageBase(body, requestFullUrl, realFullUrl);

            const $ = cheerio.load(body);
            $("head").append("<script src='https://code.jquery.com/jquery-3.6.1.min.js'></script>");
            $("head").append("<script src='js/freepik.js'></script>");
            body = internals.removeInlineContentSecurityPolicy($);
            body = internals.removeUselessParts($, request, targetedHost);
        }
    } else if (handlerHelpers.isXml(body)) {
        body = await internals.injectScriptInXml(body, request);
        
        let regx = `https://${targetedHost}`;
        body = body.toString().replace(new RegExp(regx, "g"), `https://${currentDomain}`);
        body = body.replace(new RegExp(`https:\/\/${targetedHost}`), `http:\/\/${currentDomain}`)
        body = Buffer.from(body, "utf-8");
    }
    reply.header("content-length", Buffer.byteLength(body));
    reply.status(statusCode).send(body);
}

internals.removeInlineContentSecurityPolicy = function($) {
    const metaElms = $("meta");
    metaElms.each(function() {
        if (/Content-Security-Policy/i.test($(this).attr("http-equiv"))) {
            $(this).remove();
        }
    });
    return $.html();
}
internals.removeUselessParts = function($, req, targetedHost) {
    const scripts = $("script");
    const anchors = $("a");
    const forms = $("form");
    const iframes = $("iframe");
    scripts.each(function() {
        const src = $(this).attr("src");
        const xlinkHref = $(this).attr("xlink:href");
        if (typeof src === "undefined") {
            let jsCode = $(this).html();
            try {
                let regx = `https://${targetedHost}`;
                jsCode = jsCode.replace(new RegExp(regx, "g"), `https://${currentDomain}`);
            } catch (error) {
                utils.writeToLog("Failed to parse code \n" + jsCode);
            }
            $(this).html(jsCode);
        } else {
            $(this).attr("src", handlerHelpers.modifyUrl(src, currentDomain));
        }
        if (typeof xlinkHref !== "undefined") {
            $(this).attr("xlink:href", handlerHelpers.modifyUrl(xlinkHref, currentDomain));
        }
    });
    anchors.each(function() {
        const href = $(this).attr("href");
        $(this).attr("href", handlerHelpers.modifyUrl(href, currentDomain));
    });
    forms.each(function() {
        const action = $(this).attr("action");
        $(this).attr("action", handlerHelpers.modifyUrl(action, currentDomain));
    });
    iframes.each(function() {
        const src = $(this).attr("src");
        $(this).attr("src", handlerHelpers.modifyUrl(src, currentDomain));
    });
    $("#footer > .footer__bottom > .container > .row > .mg-none:nth-child(2)").remove();
    return $.html();
}
internals.injectScriptInXml = async function(xmlDoc, req) {
    const localHost = currentDomain;
    const matchesItems = (xmlDoc + '').match(/href=".+"/g);

    if (Array.isArray(matchesItems)) {
        for (let i = 0; i < matchesItems.length; i++) {
            let newUrl = handlerHelpers.modifyUrl((matchesItems[i] + '').replace('href="', '').replace('"', ''), localHost);

            if (/&/.test(newUrl)) {
                const urlObjt = new URL(newUrl);
                newUrl = urlObjt.protocol + '//' + urlObjt.host + urlObjt.pathname + '?' +
                    handlerHelpers.MCOP_COMPOSITE_GET_VAR_NAME + '=' + btoa(urlObjt.search);
            }

            const newHref = 'href="' + newUrl + '"';
            xmlDoc = (xmlDoc + '').replace(matchesItems[i], newHref);
        }
    }

    return xmlDoc;
};

internals.isForbiddenUrl = function(url) {
    return false;
    // return typeof url !== "string" || url === "/" ||
    //     /\/account\/(settings|users|modules|invoices|google|labs|learning-hub|shortlinks|pins|watchlist|downloads|alerts|api)/.test(url)
    //     || /\/sistrix\/logout/.test(url) || /\/sistrix\/upgrade/.test(url)
    //     || /\/amazon\/index\/country\/de/.test(url);
};