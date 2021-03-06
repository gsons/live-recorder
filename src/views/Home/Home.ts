import {Vue, Component} from "vue-property-decorator"
import LiveFactory from "../../vendor/live/LiveFactory";
import Recorder from "../../vendor/resource/Recorder";
import path from "path";
import Cache from "../../vendor/Cache";
import Util from "../../vendor/Util";
import Logger from "../../vendor/Logger";
import Live from "../../vendor/live/Live";
import {LiveInfoJson, StreamJson} from "@/vendor/Json";
import fs from "fs";
import moment from "moment";
import ipc from "electron-better-ipc";
import {remote} from "electron";
import Notice from "../../vendor/Notice";

@Component({
    name: 'home'
})
export default class extends Vue {
    public siteNameList = LiveFactory.getAllSiteName();
    public siteAddress = '';
    public roomNumber = '';
    public logger = Logger.init();
    public interval?: NodeJS.Timer;
    public liveInfoList = Cache.readRoomList();
    public addLiveMethod = "输入网址";
    public siteCode = '';
    public modalAddLive = false;
    public liveInfoHeader = this.tableHeadInit();

    mounted() {
        this.siteCode = this.siteNameList[0]["siteCode"];
        this.initEvent();
    }

    beforeDestroy() {
        this.interval && clearInterval(this.interval);
    }

    created() {
        this.interval = this.refreshRoomData();
    }

    async recordRoomUrl(index: number, roomUrl: string) {
        if (this.cmdList[roomUrl]) {
            this.logger.error('重复录制了...', roomUrl);
            return;
        }
        this.liveInfoList[index]['recordStatus'] = Recorder.STATUS_RECORDING;
        this.cmdList[roomUrl] = true;
        let list: Array<StreamJson> = [];
        let live: Live;
        try {
            live = LiveFactory.getLive(roomUrl);
            await live.refreshRoomData();
            if (!live.getLiveStatus()) {
                this.cmdList[roomUrl] = null;
                this.liveInfoList[index]['recordStatus'] = Recorder.STATUS_PAUSE;
                Notice.showError(this, `主播(${live.getNickName()})尚未开播!`);
                return;
            }
            list = await live.getLiveUrl();
        } catch (error) {
            this.logger.error('获取直播源失败', error);
            this.cmdList[roomUrl] = null;
            this.liveInfoList[index]['recordStatus'] = Recorder.STATUS_AWAIT_RECORD;
            return;
        }
        let recorder = new Recorder(roomUrl);
        recorder.onErr = err => {
            let flag = false;
            for (let i = 0; i < this.liveInfoList.length; i++) {
                if (this.liveInfoList[i].roomUrl == recorder.id) {
                    this.cmdList[recorder.id] = null;
                    this.liveInfoList[i]['recordStatus'] = Recorder.STATUS_AWAIT_RECORD;
                    this.logger.error(`${live.getNickName()} ${recorder.id} 录制出错了。。。`, err);
                    flag = true;
                    break;
                }
            }
            if (!flag) {
                this.logger.info(`recorder.onErr ${live.getNickName()} ${recorder.id} 可能已经被删除。。。`);
            }
        };
        recorder.onEnd = () => {
            let flag = false;
            for (let i = 0; i < this.liveInfoList.length; i++) {
                if (this.liveInfoList[i].roomUrl == recorder.id) {
                    if (this.liveInfoList[i]['recordStatus'] == Recorder.STATUS_RECORDING) {
                        this.cmdList[recorder.id] = null;
                        this.liveInfoList[i]['recordStatus'] = Recorder.STATUS_AWAIT_RECORD;
                        this.logger.info(`${live.getNickName()} ${recorder.id} 录制完成。。。切换为待录制状态`);
                        Notice.showInfo(this, `${live.getNickName()} 录制完成,等待自动录制中。。。`);
                        return;
                    }
                    this.logger.info(`${live.getNickName()} ${recorder.id} 录制完成。。。`);
                    Notice.showInfo(this, `${live.getNickName()} 录制完成`);
                    flag = true;
                    break;
                }
            }
            if (!flag) {
                this.logger.info(`recorder.onEnd ${live.getNickName()} ${recorder.id} 可能已经被删除。。。`);
            }
        };
        let $siteName = live.getBaseSite().SITE_NAME;
        let $nickName = Util.filterEmoji(live.getNickName());
        let savePath = Util.getSavePath();
        savePath = path.join(savePath, $siteName, $nickName, moment().format('YYYY-MM-DD'));
        let dateText = moment().format('YYYYMMDD');
        let timeText = moment().format('HHmmss');
        let fileName = `${$siteName}~${$nickName}~${dateText}~${timeText}.mp4`;
        let res = Util.mkdirsSync(savePath);
        if (!res) {
            this.logger.error("创建下载目录失败", savePath);
            this.cmdList[roomUrl] = null;
            this.liveInfoList[index]['recordStatus'] = Recorder.STATUS_PAUSE;
            this.liveInfoList[index]['isAutoRecord'] = false;
            return;
        }
        savePath = path.join(savePath, fileName);
        Notice.showInfo(this, `${live.getNickName()} 开始录制。。。`);
        this.logger.info(`${live.getNickName()} ${roomUrl} 开始录制。。。`);
        this.cmdList[roomUrl] = recorder.record(list[0]["liveUrl"], savePath);
    }

    refreshRoomData() {
        let setting = Cache.getConfig();
        let time1 = new Date().getTime();
        let func = () => {
            let time2 = new Date().getTime();
            Cache.writeRoomList(this.liveInfoList);
            Promise.all(this.liveInfoList.map(async (room: LiveInfoJson, index: number) => {
                let live = LiveFactory.getLive(room.roomUrl);
                try {
                    await live.refreshRoomData();
                    room.nickName = live.getNickName();
                    room.headIcon = live.getHeadIcon();
                    room.siteIcon = live.getBaseSite().SITE_ICON + "?v=" + new Date().getTime();
                    room.title = live.getTitle() || room.title;
                    room.oldStatus = room.liveStatus;
                    room.liveStatus = live.getLiveStatus();
                } catch (error) {
                    this.logger.error({msg: '刷新房间信息失败！', roomUrl: room.roomUrl, error: error});
                }
                if (room['liveStatus'] && room['isAutoRecord'] && room['recordStatus'] == Recorder.STATUS_PAUSE) {
                    room['recordStatus'] = Recorder.STATUS_AWAIT_RECORD;
                }
                if (!room['liveStatus'] && (room['recordStatus'] == Recorder.STATUS_RECORDING || room['recordStatus'] == Recorder.STATUS_AWAIT_RECORD)) {
                    this.logger.info(`${room.nickName} ${room['roomUrl']} 自动暂停`);
                    room['recordStatus'] = Recorder.STATUS_PAUSE;
                    this.cmdList[room['roomUrl']] && Recorder.stop(this.cmdList[room['roomUrl']]);
                    this.cmdList[room['roomUrl']] = null;
                }
                if (room['recordStatus'] == Recorder.STATUS_AWAIT_RECORD && room['liveStatus']) {
                    await this.recordRoomUrl(index, room['roomUrl']);
                }
                if (!room.oldStatus && room.liveStatus && (time2 - time1) > 60000) {
                    const notification = {
                        title: `${room.siteName}(${room.nickName})开播了`,
                        body: '主播开播了，快去给心仪的主播录制吧！',
                        icon: room.headIcon,
                        requireInteraction: true,
                        sticky: true,
                    };
                    setting.notice && new Notification(notification.title, notification);
                    this.logger.info(`${room.siteName}(${room.nickName})开播了`);
                } else if (room.oldStatus && !room.liveStatus && (time2 - time1) > 60000) {
                    this.logger.info(`${room.siteName}(${room.nickName})下播了`);
                }
            })).then(() => {
                this.liveInfoList = this.liveInfoList.sort(function (a: LiveInfoJson, b: LiveInfoJson) {
                    let bb = b.liveStatus ? 1 : 0;
                    let aa = a.liveStatus ? 1 : 0;
                    return bb - aa;
                });
            }).catch((err) => {
                this.logger.error(`Promise.all : error `, err);
            });
        };
        func();
        return setInterval(() => {
            func();
        }, setting.refreshTime * 1000);
    }

    remove(index: number) {
        this.$Modal.confirm({
            title: '提示',
            content: `确认要删除该任务吗`,
            onOk: () => {
                this.liveInfoList.splice(index, 1);
                Cache.writeRoomList(this.liveInfoList);
            }
        });
    }

    async sureAddLive() {
        let live: Live;
        if (this.addLiveMethod === "输入网址") {
            try {
                live = LiveFactory.getLive(this.siteAddress);
            } catch (error) {
                this.logger.error(error);
                return;
            }
        } else if (this.addLiveMethod === "输入房间号") {
            try {
                live = LiveFactory.getLiveByRoomId(this.siteCode, this.roomNumber);
            } catch (error) {
                this.logger.error(error);
                return;
            }
        } else {
            this.logger.error('出错了。。。');
            return;
        }
        try {
            await live.refreshRoomData();
            let item: LiveInfoJson = {
                siteName: live.getBaseSite().SITE_NAME,
                siteIcon: live.getBaseSite().SITE_ICON,
                nickName: live.getNickName(),
                headIcon: live.getHeadIcon(),
                title: live.getTitle(),
                roomUrl: live.roomUrl,
                oldStatus: live.getLiveStatus(),
                liveStatus: live.getLiveStatus(),
                isAutoRecord: false,
                recordStatus: Recorder.STATUS_PAUSE,
                addTime: new Date().getTime(),
            };
            // console.log(live);
            for (let i = 0; i < this.liveInfoList.length; i++) {
                if (this.liveInfoList[i].roomUrl === live.roomUrl) {
                    Notice.showInfo(this, "该主播已存在。。。");
                    return;
                }
            }
            this.liveInfoList.unshift(item);
            Cache.writeRoomList(this.liveInfoList);
            //@ts-ignore
            this.cmdList[live.roomUrl] = null;
        } catch (error) {
            this.logger.error(error);
        }
        this.siteAddress = '';
        this.roomNumber = '';
    }

    cancelAddLive() {
        // console.log("Clicked cancel");
    }

    tableHeadInit(): Array<any> {
        return [
            {
                title: "直播平台",
                align: "center",
                key: "siteName",
                width: 150,
                // @ts-ignore
                filters: this.getSiteNameFilters(),
                filterMultiple: false,
                filterMethod(value: any, row: any) {
                    return value === row.siteName;
                },
                render: (h: any, params: any) => {
                    return h("div", {attrs: {style: ""}}, [
                        h("img", {
                            props: {
                                type: "primary",
                                size: "small"
                            },
                            attrs: {
                                src: params.row.siteIcon,
                                style:
                                    "border-radius:50%;width: 40px;height: 40px;vertical-align: middle;margin-right:10px"
                            },
                            style: {}
                        }),
                        h("span", `${params.row.siteName}`)
                    ]);
                }
            },
            {
                title: "主播名称",
                align: "left",
                key: "nickName",
                render: (h: any, params: any) => {
                    return h("div", {attrs: {style: ""}}, [
                        h("img", {
                            props: {
                                type: "primary",
                                size: "small"
                            },
                            attrs: {
                                src: params.row.headIcon,
                                style:
                                    "border-radius:50%;width: 40px;height: 40px;vertical-align: middle;margin-right:10px;cursor: pointer;"
                            },
                            style: {},
                            on: {
                                click: () => {
                                    require("electron").shell.openExternal(params.row.roomUrl);
                                }
                            }
                        }),
                        h("span", params.row.nickName, {attrs: {style: 'cursor:pointer'},})
                    ]);
                }
            },
            {
                title: "直播标题",
                align: "left",
                key: "title",
                width: 170,
            },
            {
                title: "直播状态",
                width: 112,
                align: "center",
                key: "liveStatus",
                filters: [{label: '直播中', value: true}, {label: '未开播', value: false}],
                filterMultiple: false,
                filterMethod(value: any, row: any) {
                    return value === row.liveStatus;
                },
                render: (h: any, params: any) => {
                    // @ts-ignore
                    return this.renderLiveStatus(h, params);
                }
            },
            {
                title: "自动录制",
                align: "center",
                width: 95,
                key: "isAutoRecord",

                render: (h: any, params: any) => {
                    return h('i-switch',
                        {
                            props: {
                                type: "info",
                                value: params["row"]["isAutoRecord"] === true
                            },
                            on: {
                                "on-change": (status: any) => {
                                    //@ts-ignore
                                    this.liveInfoList[params.index]['isAutoRecord'] = status;
                                    //@ts-ignore
                                    Cache.saveRoom(params['row']['roomUrl'], {'isAutoRecord': status});
                                }
                            }
                        })
                }
            },
            {
                title: "操作",
                key: "action",
                width: 125,
                align: "center",
                render: (h: any, params: any) => {
                    // @ts-ignore
                    return this.renderAction(h, params);
                }
            }
        ]
    }

    getSiteNameFilters() {
        let list = LiveFactory.getAllSiteName();
        //@ts-ignore
        let fiterList = [];
        list.forEach(vo => {
            fiterList.push({
                label: vo.siteName,
                value: vo.siteName
            });
        });
        //@ts-ignore
        return fiterList;
    }

    private renderLiveStatus(h: any, params: any) {
        if (params.row.liveStatus) {
            return h("Icon", {
                props: {
                    type: "ios-checkmark-circle",
                    size: 24,
                    color: "#00cc66"
                }
            });
        } else {
            return h("Icon", {
                props: {
                    type: "ios-close-circle",
                    size: 24,

                    color: "#ff3300"
                }
            });
        }
    }

    renderAction(h: any, params: any) {
        //@ts-ignore
        let recording = this.liveInfoList[params.index]['recordStatus'] == Recorder.STATUS_RECORDING;
        let pause = this.liveInfoList[params.index]['recordStatus'] == Recorder.STATUS_PAUSE;
        // let await = this.liveInfoList[params.index]['recordStatus'] == Recorder.STATUS_AWAIT_RECORD;
        return h("div", [
            h("Button", {
                props: {
                    type: "primary",
                    size: "small",
                    icon: recording ? "" : "md-play",
                    loading: recording,
                    shape: "circle"
                },
                style: {
                    marginRight: "5px",
                    // display: params.row.liveStatus ? 'inline-block' : 'none'
                },
                on: {
                    click: async () => {
                        if (recording) return;
                        // @ts-ignore
                        if (this.cmdList[params['row']['roomUrl']]) {
                            this.logger.error(`${params['row']['nickName']}  重复录制了。。。`);
                        }
                        await this.recordRoomUrl(params.index, params['row']['roomUrl']);
                    }
                }
            }),
            h("Button", {
                props: {
                    type: "warning",
                    size: "small",
                    icon: "ios-pause",
                    shape: "circle",
                    disabled: pause
                },
                style: {
                    marginRight: "5px",
                    display: !pause ? 'inline-block' : 'none'
                },
                on: {
                    click: () => {
                        this.logger.info(`${params.row.nickName} 暂停中。。。`);
                        if (recording) {
                            try {
                                this.liveInfoList[params.index]['recordStatus'] = Recorder.STATUS_PAUSE;
                                this.liveInfoList[params.index]['isAutoRecord'] = false;
                                Recorder.stop(this.cmdList[params.row.roomUrl]);
                                this.cmdList[params.row.roomUrl] = null;
                            } catch (error) {
                                this.logger.error(`${params.row.nickName} 暂停出错了。。。`, error);
                            }
                        } else {
                            this.liveInfoList[params.index]['recordStatus'] = Recorder.STATUS_PAUSE;
                            this.cmdList[params.row.roomUrl] = null;
                        }
                    }
                }
            }),
            h("Button", {
                props: {
                    type: "error",
                    size: "small",
                    shape: "circle",
                    icon: "ios-trash",
                    disabled: !pause
                },
                style: {
                    marginRight: "5px",
                    display: !pause ? 'none' : 'inline-block'
                },
                on: {
                    click: () => {
                        this.remove(params.index);
                    }
                }
            }),
            h("Button", {
                props: {
                    type: "warning",
                    size: "small",
                    shape: "circle",
                    icon: "ios-folder",
                },
                style: {
                    marginRight: "5px",
                },
                on: {
                    click: () => {
                        const {shell} = require("electron").remote;
                        let $siteName = params.row.siteName;
                        let $nickName = Util.filterEmoji(params.row.nickName);
                        let savePath = Util.getSavePath();
                        savePath = path.join(savePath, $siteName, $nickName);
                        if (fs.existsSync(savePath)) {
                            shell.showItemInFolder(savePath);
                        } else {
                            Notice.showInfo(this, "录制文件为空");
                        }

                    }
                }
            })
        ]);
    }

    initEvent() {
        ipc.ipcRenderer.answerMain('BrowserWindowClose', () => {
            this.$Modal.confirm({
                title: '信息',
                content: `是否确认退出`,
                loading: true,
                onOk: () => {
                    // @ts-ignore
                    this.interval && clearInterval(this.interval);
                    this.logger.info("BrowserWindow 退出,把所有录制状态设为暂停录制");
                    this.liveInfoList.forEach((item: any) => {
                        item['recordStatus'] = Recorder.STATUS_PAUSE;
                        item['liveStatus'] = false;
                        item['oldStatus'] = false;
                    });
                    for (let roomUrl in this.cmdList) {
                        if (this.cmdList.hasOwnProperty(roomUrl)) {
                            let cmd = this.cmdList[roomUrl];
                            try {
                                cmd && this.logger.debug("自动停止录播", roomUrl);
                                cmd && Recorder.stop(cmd);
                            } catch (e) {
                                this.logger.error(`暂停录制失败`, roomUrl, e);
                            }
                        }
                    }
                    Cache.writeRoomList(this.liveInfoList);
                    let time1 = new Date().getTime();
                    setInterval(() => {
                        let flag = true;
                        for (let roomUrl in this.cmdList) {
                            if (this.cmdList.hasOwnProperty(roomUrl)) {
                                let cmd = this.cmdList[roomUrl];
                                if (cmd) {
                                    flag = false;
                                    break;
                                }
                            }
                        }
                        let time2 = new Date().getTime();
                        //为了避免等待时间过长
                        if (flag || (time2 - time1) > 10000) remote.app.exit();
                    }, 100);
                }
            })
        });
    }
}



