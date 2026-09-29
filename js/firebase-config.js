// Firebase の接続設定
// Firebase コンソール → プロジェクトの設定 → マイアプリ（ウェブアプリ）→「SDK の設定と構成」の値を貼り付けてください。
// ここに書く値はブラウザに公開される前提のもので、秘密鍵ではありません。
// データの保護は firestore.rules（各ユーザーが自分のデータだけ読み書きできるルール）で行います。

export const firebaseConfig = {
  apiKey: "AIzaSyAXAKnmJTG1CYWFoJOkSs1qFnSSaNJNmJ4",
  authDomain: "efootball-status.firebaseapp.com",
  projectId: "efootball-status",
  storageBucket: "efootball-status.firebasestorage.app",
  messagingSenderId: "818530370076",
  appId: "1:818530370076:web:f6b3008a1cd33fbb8c95d9",
  measurementId: "G-HPJYNLBR4T"
};

// 読み込む Firebase JavaScript SDK のバージョン
export const FIREBASE_SDK_VERSION = "12.19.0";
