import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const pc_config = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
  ],
};
const SOCKET_SERVER_URL = "http://43.201.110.253:8081";

const App = () => {
  const socketRef = useRef<SocketIOClient.Socket>();
  const pcRef = useRef<RTCPeerConnection>();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  
  // 수신된 메시지 상태 관리
  const [receivedMessage, setReceivedMessage] = useState<string>("");

  const setVideoTracks = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (!(pcRef.current && socketRef.current)) return;
      stream.getTracks().forEach((track) => {
        if (!pcRef.current) return;
        pcRef.current.addTrack(track, stream);
      });
      
      // 데이터 채널 이벤트 리스너 설정
      pcRef.current.ondatachannel = (event) => {
        const dataChannel = event.channel;
        dataChannel.onmessage = (e) => {
          console.log("메시지 수신:", e.data);
          setReceivedMessage(e.data);
        };
        dataChannel.onopen = () => {
          console.log("데이터 채널이 열렸습니다.");
        };
        dataChannel.onclose = () => {
          console.log("데이터 채널이 닫혔습니다.");
        };
      };
      
      pcRef.current.onicecandidate = (e) => {
        if (e.candidate) {
          if (!socketRef.current) return;
          console.log("onicecandidate");
          socketRef.current.emit("candidate", e.candidate);
        }
      };
      pcRef.current.oniceconnectionstatechange = (e) => {
        console.log(e);
      };
      socketRef.current.emit("join_room", {
        room: "1234",
      });
    } catch (e) {
      console.error(e);
    }
  };

  const createOffer = async () => {
    console.log("create offer");
    if (!(pcRef.current && socketRef.current)) return;
    try {
      const sdp = await pcRef.current.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pcRef.current.setLocalDescription(new RTCSessionDescription(sdp));
      socketRef.current.emit("offer", sdp);
    } catch (e) {
      console.error(e);
    }
  };

  const createAnswer = async (sdp: RTCSessionDescription) => {
    if (!(pcRef.current && socketRef.current)) return;
    try {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log("answer set remote description success");
      const mySdp = await pcRef.current.createAnswer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false,
      });
      console.log("create answer");
      await pcRef.current.setLocalDescription(new RTCSessionDescription(mySdp));
      socketRef.current.emit("answer", mySdp);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    // 연결 옵션 추가 (수정된 부분)
    socketRef.current = io.connect(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true
    });
    pcRef.current = new RTCPeerConnection(pc_config);

    socketRef.current.on("all_users", (allUsers: Array<{ id: string }>) => {
      if (allUsers.length > 0) {
        createOffer();
      }
    });

    socketRef.current.on("getOffer", (sdp: RTCSessionDescription) => {
      console.log("get offer");
      createAnswer(sdp);
    });

    socketRef.current.on("getAnswer", (sdp: RTCSessionDescription) => {
      console.log("get answer");
      if (!pcRef.current) return;
      pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
    });

    socketRef.current.on(
      "getCandidate",
      async (candidate: RTCIceCandidateInit) => {
        if (!pcRef.current) return;
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        console.log("candidate add success");
      }
    );

    setVideoTracks();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#f5f5f5'
    }}>
      <h1 style={{
        textAlign: "center",
        color: "#333",
        margin: "0 0 20px 0",
        fontWeight: "bold"
      }}>SENDER</h1>
      <video
        style={{
          width: 480,
          height: 480,
          backgroundColor: "black",
          borderRadius: "8px",
          boxShadow: "0 4px 8px rgba(0,0,0,0.1)"
        }}
        muted
        ref={localVideoRef}
        autoPlay
      />
      
      {/* 수신된 메시지 표시 영역 */}
      {receivedMessage && (
        <div style={{
          marginTop: '20px',
          padding: '10px 15px',
          backgroundColor: '#e1f5fe',
          borderRadius: '4px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          maxWidth: '480px',
          width: '100%',
          wordBreak: 'break-word',
          fontSize: '16px'
        }}>
          <strong>수신된 메시지:</strong> {receivedMessage}
        </div>
      )}
    </div>
  );
};

export default App;