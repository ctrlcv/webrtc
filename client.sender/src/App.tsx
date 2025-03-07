import React, { useEffect, useRef, useState, useCallback } from "react";
import io from "socket.io-client";

// process 객체가 없을 경우 폴리필 추가 (타입 오류 해결)
if (typeof window !== 'undefined' && !window.process) {
  window.process = {
    env: {
      NODE_ENV: 'development',
      PUBLIC_URL: '',
      REACT_APP_VERSION: '1.0.0'
    }
  } as any;
}

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
  const localStreamRef = useRef<MediaStream>();
  const dataChannelRef = useRef<RTCDataChannel>();
  const iceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  
  // 수신된 메시지 상태 관리
  const [receivedMessage, setReceivedMessage] = useState<string>("");
  // 연결 상태 표시
  const [connectionStatus, setConnectionStatus] = useState<string>("연결 중...");
  // 재연결 트리거
  const [reconnectTrigger, setReconnectTrigger] = useState<number>(0);
  // 데이터 채널 연결 상태
  const [dataChannelConnected, setDataChannelConnected] = useState<boolean>(false);

  // 미디어 스트림 설정
  const setVideoTracks = useCallback(async () => {
    console.log("미디어 스트림 설정 시작");
    try {
      // 이미 스트림이 있으면 정리
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      console.log("미디어 스트림 획득 성공:", stream.id);
      console.log("비디오 트랙:", stream.getVideoTracks().length);
      console.log("오디오 트랙:", stream.getAudioTracks().length);
      
      // 스트림 참조 저장
      localStreamRef.current = stream;
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log("로컬 비디오 요소에 스트림 설정 완료");
      }
      
      if (!(pcRef.current && socketRef.current)) {
        console.error("PeerConnection 또는 Socket이 초기화되지 않음");
        return;
      }
      
      // 모든 트랙을 PeerConnection에 추가
      stream.getTracks().forEach((track) => {
        if (!pcRef.current) return;
        console.log(`트랙 추가: ${track.kind}`);
        pcRef.current.addTrack(track, stream);
      });
      
      // 데이터 채널 이벤트 리스너 설정
      pcRef.current.ondatachannel = (event) => {
        const dataChannel = event.channel;
        dataChannelRef.current = dataChannel;
        console.log("데이터 채널 수신:", dataChannel.label);
        
        dataChannel.onmessage = (e) => {
          console.log("메시지 수신:", e.data);
          setReceivedMessage(e.data);
        };
        
        dataChannel.onopen = () => {
          console.log("데이터 채널이 열렸습니다.");
          setConnectionStatus("연결됨");
          setDataChannelConnected(true);
        };
        
        dataChannel.onclose = () => {
          console.log("데이터 채널이 닫혔습니다.");
          setConnectionStatus("연결 끊김");
          setDataChannelConnected(false);
        };
      };
      
      pcRef.current.onicecandidate = (e) => {
        if (e.candidate) {
          if (!socketRef.current) return;
          console.log("ICE candidate 생성:", e.candidate.candidate.substr(0, 50) + "...");
          
          // ICE 후보 저장
          iceCandidatesRef.current.push(e.candidate);
          
          // ICE 후보 전송
          socketRef.current.emit("candidate", e.candidate);
        }
      };
      
      pcRef.current.oniceconnectionstatechange = () => {
        const state = pcRef.current?.iceConnectionState;
        console.log("ICE 연결 상태 변경:", state);
        
        if (state === "connected" || state === "completed") {
          setConnectionStatus("연결됨");
        } else if (state === "disconnected") {
          setConnectionStatus("연결 끊김");
          setDataChannelConnected(false);
          // 5초 후 재연결 시도
          setTimeout(() => {
            setReconnectTrigger(prev => prev + 1);
          }, 5000);
        } else if (state === "failed") {
          setConnectionStatus("연결 실패");
          setDataChannelConnected(false);
          // 즉시 재연결 시도
          setReconnectTrigger(prev => prev + 1);
        } else if (state === "checking") {
          setConnectionStatus("연결 확인 중...");
        }
      };
      
      // 연결 상태 변경 이벤트 추가
      pcRef.current.onconnectionstatechange = () => {
        const state = pcRef.current?.connectionState;
        console.log("연결 상태 변경:", state);
        
        if (state === "connected") {
          setConnectionStatus("연결됨");
        } else if (state === "disconnected" || state === "failed" || state === "closed") {
          setConnectionStatus("연결 끊김");
          setDataChannelConnected(false);
        } else if (state === "connecting") {
          setConnectionStatus("연결 중...");
        }
      };
      
      // 방 참가 이벤트 발생
      socketRef.current.emit("join_room", {
        room: "1234",
      });
      console.log("방 참가 요청 전송");
      
    } catch (e) {
      console.error("미디어 스트림 설정 오류:", e);
      setConnectionStatus("미디어 액세스 오류");
    }
  }, []);

  // Offer 생성
  const createOffer = useCallback(async () => {
    console.log("Offer 생성 시작");
    if (!(pcRef.current && socketRef.current)) {
      console.error("PeerConnection 또는 Socket이 초기화되지 않음");
      return;
    }
    
    try {
      const sdp = await pcRef.current.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      console.log("Offer SDP 생성 완료");
      
      await pcRef.current.setLocalDescription(new RTCSessionDescription(sdp));
      console.log("Local description 설정 완료");
      
      socketRef.current.emit("offer", sdp);
      console.log("Offer 전송 완료");
    } catch (e) {
      console.error("Offer 생성 오류:", e);
    }
  }, []);

  // Answer 생성
  const createAnswer = useCallback(async (sdp: RTCSessionDescription) => {
    console.log("Answer 생성 시작");
    if (!(pcRef.current && socketRef.current)) {
      console.error("PeerConnection 또는 Socket이 초기화되지 않음");
      return;
    }
    
    try {
      console.log("Remote description 설정 시도 (answer)");
      console.log("현재 signaling 상태:", pcRef.current.signalingState);
      
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      console.log("Remote description 설정 완료");
      
      const mySdp = await pcRef.current.createAnswer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false,
      });
      console.log("Answer SDP 생성 완료");
      
      await pcRef.current.setLocalDescription(new RTCSessionDescription(mySdp));
      console.log("Local description 설정 완료");
      
      socketRef.current.emit("answer", mySdp);
      console.log("Answer 전송 완료");
    } catch (e) {
      console.error("Answer 생성 오류:", e);
    }
  }, []);

  // 연결 초기화
  const initializeConnection = useCallback(() => {
    console.log("연결 초기화");
    
    // 기존 연결 정리
    if (pcRef.current) {
      pcRef.current.close();
    }
    
    // ICE 후보 초기화
    iceCandidatesRef.current = [];
    
    // 데이터 채널 연결 상태 초기화
    setDataChannelConnected(false);
    
    // RTCPeerConnection 초기화
    pcRef.current = new RTCPeerConnection(pc_config);
    console.log("RTCPeerConnection 초기화 완료");
    
    // 미디어 스트림 설정
    setVideoTracks();
  }, [setVideoTracks]);

  // 재연결 효과
  useEffect(() => {
    if (reconnectTrigger > 0) {
      console.log("재연결 시도:", reconnectTrigger);
      initializeConnection();
    }
  }, [reconnectTrigger, initializeConnection]);

  // 연결 상태 주기적 확인
  useEffect(() => {
    const checkConnectionStatus = () => {
      // 데이터 채널이 열려 있으면 연결됨으로 간주
      if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
        setDataChannelConnected(true);
        setConnectionStatus("연결됨");
        return;
      }
      
      // PeerConnection 상태 확인
      if (pcRef.current) {
        const iceState = pcRef.current.iceConnectionState;
        const connState = pcRef.current.connectionState;
        
        if ((iceState === "connected" || iceState === "completed") && 
            (connState === "connected")) {
          setConnectionStatus("연결됨");
        }
      }
    };
    
    // 5초마다 연결 상태 확인
    const intervalId = setInterval(checkConnectionStatus, 5000);
    
    // 초기 상태 확인
    checkConnectionStatus();
    
    return () => {
      clearInterval(intervalId);
    };
  }, []);

  // 초기 설정
  useEffect(() => {
    console.log("컴포넌트 마운트 - 연결 초기화");
    
    // Socket.IO 연결 설정
    socketRef.current = io.connect(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    console.log("Socket.IO 연결 시도");
    
    // Socket.IO 이벤트 리스너 설정
    socketRef.current.on("connect", () => {
      console.log("Socket.IO 서버에 연결됨");
      initializeConnection();
    });
    
    socketRef.current.on("connect_error", (error: any) => {
      console.error("Socket.IO 연결 오류:", error);
      setConnectionStatus("서버 연결 오류");
    });
    
    socketRef.current.on("all_users", (allUsers: Array<{ id: string }>) => {
      console.log("all_users 이벤트 수신:", allUsers);
      if (allUsers.length > 0) {
        createOffer();
      }
    });

    socketRef.current.on("getOffer", (sdp: RTCSessionDescription) => {
      console.log("getOffer 이벤트 수신");
      createAnswer(sdp);
    });

    socketRef.current.on("getAnswer", async (sdp: RTCSessionDescription) => {
      console.log("getAnswer 이벤트 수신");
      if (!pcRef.current) return;
      
      // 현재 연결 상태 확인
      const currentState = pcRef.current.signalingState;
      console.log("Current signaling state:", currentState);
      
      try {
        // stable 상태가 아닐 때만 setRemoteDescription 실행
        if (currentState !== "stable") {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
          console.log("Remote description 설정 완료 (answer)");
          
          // answer 설정 후 stable 상태가 되면 연결 성공으로 간주
          if (pcRef.current.signalingState === "stable") {
            setConnectionStatus("연결됨");
          }
        } else {
          console.log("이미 stable 상태, answer 무시");
        }
      } catch (error) {
        console.error("Remote description 설정 오류:", error);
        // 오류 발생 시 재연결 시도
        setTimeout(() => {
          setReconnectTrigger(prev => prev + 1);
        }, 2000);
      }
    });

    socketRef.current.on(
      "getCandidate",
      async (candidate: RTCIceCandidateInit) => {
        if (!pcRef.current) return;
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          console.log("ICE candidate 추가 완료");
        } catch (error) {
          console.error("ICE candidate 추가 오류:", error);
        }
      }
    );

    // 컴포넌트 언마운트 시 정리
    return () => {
      console.log("컴포넌트 언마운트 - 연결 정리");
      
      // 미디어 스트림 정리
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
        });
      }
      
      // Socket.IO 연결 종료
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      
      // RTCPeerConnection 종료
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, [createOffer, createAnswer, initializeConnection]);

  // 수동 재연결 핸들러
  const handleReconnect = () => {
    setReconnectTrigger(prev => prev + 1);
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
      }}>SENDER</h1>
      
      {/* 연결 상태 표시 */}
      <div style={{
        padding: '5px 10px',
        backgroundColor: dataChannelConnected ? '#e6f7e6' : '#ffe6e6',
        borderRadius: '4px',
        marginBottom: '10px',
        color: dataChannelConnected ? '#2e7d32' : '#c62828',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px'
      }}>
        <span>{dataChannelConnected ? "연결됨" : connectionStatus}</span>
        {!dataChannelConnected && (
          <button 
            onClick={handleReconnect}
            style={{
              padding: '2px 8px',
              backgroundColor: '#f5f5f5',
              border: '1px solid #ccc',
              borderRadius: '3px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            재연결
          </button>
        )}
      </div>
      
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
        playsInline
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