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
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const dataChannelRef = useRef<RTCDataChannel>();
  
  // 입력창 상태 관리
  const [message, setMessage] = useState<string>("");

  const setupConnection = async () => {
    try {
      if (!(pcRef.current && socketRef.current)) return;
      
      // 빈 오디오 트랙을 생성하여 연결에 추가 (송신은 하지 않지만 연결 유지를 위해)
      const emptyAudioTrack = createEmptyAudioTrack();
      const emptyAudioStream = new MediaStream([emptyAudioTrack]);
      
      // 빈 트랙을 추가하되 실제로 데이터는 전송하지 않음
      pcRef.current.addTrack(emptyAudioTrack, emptyAudioStream);
      
      // 데이터 채널 생성
      dataChannelRef.current = pcRef.current.createDataChannel("textChannel");
      dataChannelRef.current.onopen = () => {
        console.log("데이터 채널이 열렸습니다.");
      };
      dataChannelRef.current.onclose = () => {
        console.log("데이터 채널이 닫혔습니다.");
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
      pcRef.current.ontrack = (ev) => {
        console.log("add remotetrack success");
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = ev.streams[0];
        }
      };
      socketRef.current.emit("join_room", {
        room: "1234",
      });
    } catch (e) {
      console.error(e);
    }
  };

  // 메시지 전송 함수
  const sendMessage = () => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      alert("연결이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    
    if (message.trim() === "") return;
    
    dataChannelRef.current.send(message);
    setMessage(""); // 입력창 초기화
  };

  // 빈 오디오 트랙 생성 함수
  const createEmptyAudioTrack = () => {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = ctx.createMediaStreamDestination();
    oscillator.connect(dst);
    oscillator.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = false; // 오디오 트랙을 비활성화하여 실제 소리가 전송되지 않도록 함
    return track;
  };

  const createOffer = async () => {
    console.log("create offer");
    if (!(pcRef.current && socketRef.current)) return;
    try {
      const sdp = await pcRef.current.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
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
        offerToReceiveVideo: true,
        offerToReceiveAudio: true,
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

    setupConnection();

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, []);

  // Enter 키 이벤트 처리
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  };

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
      }}>RECEIVER</h1>
      <video
        id="remotevideo"
        style={{
          width: 480,
          height: 480,
          backgroundColor: "black",
          borderRadius: "8px",
          boxShadow: "0 4px 8px rgba(0,0,0,0.1)"
        }}
        ref={remoteVideoRef}
        autoPlay
      />
      
      {/* 메시지 입력 영역 */}
      <div style={{
        display: 'flex',
        marginTop: '20px',
        width: '480px',
      }}>
        <input
          type="text"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="메시지를 입력하세요..."
          style={{
            flex: 1,
            padding: '10px',
            borderRadius: '4px 0 0 4px',
            border: '1px solid #ccc',
            fontSize: '16px',
          }}
        />
        <button
          onClick={sendMessage}
          style={{
            padding: '10px 20px',
            backgroundColor: '#4285f4',
            color: 'white',
            border: 'none',
            borderRadius: '0 4px 4px 0',
            cursor: 'pointer',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          SEND
        </button>
      </div>
    </div>
  );
};

export default App;