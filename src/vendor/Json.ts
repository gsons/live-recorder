interface SiteJson {
    SITE_NAME: string;
    SITE_CODE: string;
    SITE_ICON: string;
    MATCH_ROOM_URL: RegExp;
    BASE_ROOM_URL: string;
}

interface StreamJson {
    'quality': string;
    'lineIndex': string;
    'liveUrl': string;
}

interface LiveInfoJson {
    siteName: string,
    siteIcon: string,
    nickName: string,
    headIcon: string,
    title: string,
    roomUrl: string,
    oldStatus: boolean,//上次检测直播状态
    liveStatus: boolean,//这次检测直播状态
    isAutoRecord: boolean,
    recordStatus: number,
    addTime: number,
}

interface settingJson {
    savePath: string,
    refreshTime: number,
    videoTime: number,
    notice: boolean,
}

interface settingJson {
    savePath: string,
    refreshTime: number,
    videoTime: number,
    notice: boolean,
}


interface ResourceJson {
    url: string,
    resourceUrl: string,
    id: number,
    addTime: number,
    downloadStatus: number,
    name: string,
    type: number,
}

interface Cmd {
    [key: string]: any
}

interface WebViewData {
    readonly userAgent: string,
    src: string,
    preload: string
}

export {SiteJson, StreamJson, LiveInfoJson, settingJson, ResourceJson, Cmd, WebViewData};

