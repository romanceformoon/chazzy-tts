import {ChatCmd} from "chzzk"
import {useCallback, useEffect, useRef, useState} from "react"
import {nicknameColors} from "./constants"
import {Chat} from "./types"

export default function useChatList(chatChannelId: string, accessToken: string) {
    const currentWebSocketBusterRef = useRef<number>(0)
    const lastSetTimestampRef = useRef<number>(0)
    const pendingChatListRef = useRef<Chat[]>([])
    const [chatList, setChatList] = useState<Chat[]>([])
    const [webSocketBuster, setWebSocketBuster] = useState<number>(0)

    const convertChat = useCallback((raw): Chat => {
        const profile = JSON.parse(raw['profile'])
        const extras = JSON.parse(raw['extras'])
        const nickname = profile.nickname
        const badge = profile.badge ? {
            name: profile.title.name, src: profile.badge.imageUrl
        } : null
        const badges = (badge ? [badge] : []).concat(
            profile.activityBadges
                ?.filter(badge => badge.activated)
                ?.map(badge => ({name: badge.title, src: badge.imageUrl})) ?? []
        )
        const color = profile.title?.color ?? (profile.userIdHash + chatChannelId).split("")
            .map(c => c.charCodeAt(0))
            .reduce((a, b) => a + b, 0) % nicknameColors.length
        const emojis = extras?.emojis || {}
        const message = raw['msg'] || raw['content']
        return {
            uid: Math.random().toString(36).substring(2, 12),
            time: raw['msgTime'] || raw['messageTime'],
            nickname,
            badges,
            color,
            emojis,
            message
        }
    }, [chatChannelId])

    const connectChzzk = useCallback(() => {
        const ws = new WebSocket("wss://kr-ss1.chat.naver.com/chat")

        const worker = new Worker(
            URL.createObjectURL(new Blob([`
                let timeout = null

                onmessage = (e) => {
                    if (e.data === "startPingTimer") {
                        if (timeout != null) {
                            clearTimeout(timeout)
                        }
                        timeout = setTimeout(function reservePing() {
                            postMessage("ping")
                            timeout = setTimeout(reservePing, 20000)
                        }, 20000)
                    }
                    if (e.data === "stop") {
                        if (timeout != null) {
                            clearTimeout(timeout)
                        }
                    }
                }
            `], {type: "application/javascript"}))
        )

        worker.onmessage = (e) => {
            if (e.data === "ping") {
                ws.send(JSON.stringify({
                    ver: "2",
                    cmd: ChatCmd.PING
                }))
            }
        }

        const defaults = {
            cid: chatChannelId,
            svcid: "game",
            ver: "2"
        }

        ws.onopen = () => {
            ws.send(JSON.stringify({
                bdy: {
                    accTkn: accessToken,
                    auth: "READ",
                    devType: 2001,
                    uid: null
                },
                cmd: ChatCmd.CONNECT,
                tid: 1,
                ...defaults
            }))
        }

        ws.onclose = () => {
            if (webSocketBuster !== currentWebSocketBusterRef.current) {
                setTimeout(() => {
                    const newWebSocketBuster = new Date().getTime()
                    currentWebSocketBusterRef.current = newWebSocketBuster
                    setWebSocketBuster(newWebSocketBuster)
                }, 1000)
            }
        }

        ws.onmessage = (event: MessageEvent) => {
            const json = JSON.parse(event.data)

            switch (json.cmd) {
                case ChatCmd.PING:
                    ws.send(JSON.stringify({
                        ver: "2",
                        cmd: ChatCmd.PONG,
                    }))
                    break
                case ChatCmd.CONNECTED:
                    const sid = json.bdy.sid
                    ws.send(JSON.stringify({
                        bdy: {recentMessageCount: 50},
                        cmd: ChatCmd.REQUEST_RECENT_CHAT,
                        sid,
                        tid: 2,
                        ...defaults
                    }))
                    break
                case ChatCmd.RECENT_CHAT:
                case ChatCmd.CHAT:
                    const isRecent = json.cmd == ChatCmd.RECENT_CHAT
                    const chats = (isRecent ? json['bdy']['messageList'] : json['bdy'])
                        .filter(chat => (chat['msgTypeCode'] || chat['messageTypeCode']) == 1)
                        .filter(chat => !((chat['msgStatusType'] || chat['messageStatusType']) == "HIDDEN"))
                        .map(convertChat)

                    if (isRecent) {
                        pendingChatListRef.current = []
                        setChatList(chats)
                    } else {
                        pendingChatListRef.current = [...pendingChatListRef.current, ...chats].slice(-50)
                    }
                    break
            }

            if (json.cmd !== ChatCmd.PONG) {
                worker.postMessage("startPingTimer")
            }
        }

        worker.postMessage("startPingTimer")

        return () => {
            worker.postMessage("stop")
            worker.terminate()
            ws.close()
        }
    }, [accessToken, chatChannelId, convertChat, webSocketBuster])

    useEffect(() => {
        return connectChzzk()
    }, [connectChzzk, webSocketBuster])

    useEffect(() => {
        const interval = setInterval(() => {
            if (pendingChatListRef.current.length > 0) {
                if (new Date().getTime() - lastSetTimestampRef.current > 1000) {
                    setChatList((prevChatList) => {
                        return [
                            ...prevChatList.slice(pendingChatListRef.current.length - 50),
                            ...pendingChatListRef.current,
                        ]
                    })
                    pendingChatListRef.current = []
                } else {
                    const chat = pendingChatListRef.current.shift()
                    setChatList((prevChatList) => {
                        const newChatList = [...prevChatList, chat]
                        if (newChatList.length > 50) {
                            newChatList.shift()
                        }
                        return newChatList
                    })
                }
            }
            lastSetTimestampRef.current = new Date().getTime()
        }, 75)
        return () => {
            clearInterval(interval)
            lastSetTimestampRef.current = 0
        }
    }, [])

    return chatList
}
