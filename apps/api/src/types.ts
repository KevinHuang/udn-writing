// OAuth Token 回應
export interface TokenResponse {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
    refresh_token?: string;
}

export interface Identity {
    identity_type: string;
    account: string;
    name: string;
    school_name: string;
    school_type: string;
}

// 使用者資訊回應
export interface UserInfo {
    uuid: string;
    firstName: string;
    lastName: string;
    language: string;
    mail: string;
    isSystemAdmin: boolean;
    isSchoolAdmin: boolean;
    isInstructor: boolean;
    isLearner: boolean;
    clientIP: string;
    id: number;
    targetDSNS: string;
    ref_school_id: string;
    account: string;    // 帳號(mail)
    roles: Identity[];
}

// Session 使用者物件
export interface SessionUser {
    uuid: string;
    name: string;
    mail: string;
    language: string;
    accessToken: string;
    loginTime: number;
}

export interface Task {
    id: string;
    title: string;
    description: string;
    level: string[];
    source: string[];
    note: string;
    pic1: string;
    ref_user_id: number;
    ref_org_id: number;
    shared: boolean;
    created_time: string;
    updated_time: string;
    ref_instruction_id: number;
}