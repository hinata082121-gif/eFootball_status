// Firebase の接続設定
// Firebase コンソール → プロジェクトの設定 → マイアプリ（ウェブアプリ）→「SDK の設定と構成」の値を貼り付けてください。
// ここに書く値はブラウザに公開される前提のもので、秘密鍵ではありません。
// データの保護は firestore.rules（各ユーザーが自分のデータだけ読み書きできるルール）で行います。

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 読み込む Firebase JavaScript SDK のバージョン
export const FIREBASE_SDK_VERSION = "12.19.0";
