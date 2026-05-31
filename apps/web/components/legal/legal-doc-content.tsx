export function TermsDocContent() {
  return (
    <div className="huma-legal-doc">
      <div>
        <p className="text-huma-t2">
          본 약관은 테크앤조이(이하 &quot;회사&quot;)가 운영하는 자동화 관리 플랫폼 HUMA Studio(이하
          &quot;서비스&quot;, <a href="https://romang-ai.com">https://romang-ai.com</a>)의 이용과 관련하여 회사와
          서비스 이용자(이하 &quot;관리자&quot;) 간의 권리·의무 및 책임 사항을 규정합니다.
        </p>
        <p className="huma-legal-doc-footnote">시행일: 2026년 6월 1일</p>
      </div>

      <div>
        <h3>제1장 총칙</h3>

        <div>
          <h4>제1조 (목적)</h4>
          <p>
            본 약관은 회사가 제공하는 HUMA Studio의 이용 조건, 관리자와 회사의 권리·의무, 서비스 운영에 관한
            기본 사항을 정함을 목적으로 합니다.
          </p>
        </div>

        <div>
          <h4>제2조 (용어의 정의)</h4>
          <ol>
            <li>
              <strong>HUMA Studio</strong>: 연운(緣運), 퀴즈오아시스, 파나나 등 회사가 운영하는 서비스의
              콘텐츠 발행·자동화·운영을 통합 관리하기 위한 내부 관리자용 웹·API 플랫폼을 말합니다.
            </li>
            <li>
              <strong>관리자</strong>: 회사가 별도로 계정을 부여하고 본 약관에 동의한 후 서비스에 로그인하여
              이용하는 자를 말합니다.
            </li>
            <li>
              <strong>워크스페이스</strong>: 관리자에게 할당된 서비스 단위(연운, 퀴즈오아시스, 파나나 등)를
              말합니다.
            </li>
            <li>
              <strong>Worker</strong>: Playwright·BullMQ 등을 통해 실제 자동화 작업을 수행하는 회사
              운영 서버(i7 등)를 말합니다.
            </li>
            <li>
              <strong>연동 서비스</strong>: Google AdSense, Supabase, Cloudflare, Anthropic, Higgsfield 등
              서비스 기능을 위해 연결하는 외부 API·인프라를 말합니다.
            </li>
          </ol>
        </div>

        <div>
          <h4>제3조 (약관의 효력 및 변경)</h4>
          <ol>
            <li>본 약관은 서비스 화면에 게시하거나 관리자에게 통지함으로써 효력이 발생합니다.</li>
            <li>
              회사는 관련 법령을 위반하지 않는 범위에서 약관을 개정할 수 있으며, 개정 시 적용일자 및
              개정 사유를 서비스 또는 공지를 통해 사전에 안내합니다.
            </li>
            <li>관리자가 개정 약관 시행일 이후에도 서비스를 계속 이용하는 경우 개정 약관에 동의한 것으로
              봅니다.
            </li>
          </ol>
        </div>
      </div>

      <div>
        <h3>제2장 서비스 이용</h3>

        <div>
          <h4>제4조 (서비스의 내용)</h4>
          <p>HUMA Studio는 다음과 같은 기능을 제공합니다(일부는 워크스페이스별로 상이할 수 있음).</p>
          <ul>
            <li>발행·작업 큐, 캘린더, 운영 모니터링 및 로그 조회</li>
            <li>네이버 블로그·카페 등 Playwright 기반 자동화 작업 관리</li>
            <li>LTE 모뎀·프록시 슬롯 관리 및 계정 연동</li>
            <li>소셜·영상 파이프라인, 카페 바이럴, C-Rank 등 운영 도구</li>
            <li>Google AdSense 수익 통계 등 연동 API 기반 리포트</li>
            <li>기타 회사가 추가·변경하는 관리 기능</li>
          </ul>
        </div>

        <div>
          <h4>제5조 (관리자 계정)</h4>
          <ol>
            <li>서비스는 회사가 승인한 관리자만 이용할 수 있으며, 공개 회원가입을 제공하지 않습니다.</li>
            <li>관리자는 부여받은 아이디·비밀번호를 직접 관리해야 하며, 제3자에게 양도·대여·공유할 수
              없습니다.
            </li>
            <li>관리자는 워크스페이스 권한 범위를 초과하여 데이터에 접근하거나 작업을 실행해서는 안
              됩니다.
            </li>
            <li>계정 정보 유출·무단 사용이 의심되는 경우 즉시 회사에 통지해야 합니다.</li>
          </ol>
        </div>

        <div>
          <h4>제6조 (서비스 제공 및 변경·중단)</h4>
          <ol>
            <li>서비스는 원칙적으로 연중무휴 제공을 목표로 하나, Worker·Tunnel·외부 API 장애 등으로
              일시 중단될 수 있습니다.
            </li>
            <li>회사는 시스템 점검, 보안 패치, 기능 개선 등을 위해 서비스의 전부 또는 일부를
              일시 중단할 수 있습니다.
            </li>
            <li>회사는 서비스의 내용·구성·UI·API를 운영상 필요에 따라 변경할 수 있습니다.</li>
          </ol>
        </div>
      </div>

      <div>
        <h3>제3장 관리자의 의무</h3>

        <div>
          <h4>제7조 (금지 행위)</h4>
          <p>관리자는 다음 행위를 해서는 안 됩니다.</p>
          <ol>
            <li>타인의 계정·API 키·OAuth 토큰·모뎀 슬롯 등을 무단 사용하는 행위</li>
            <li>관련 법령, 네이버·Google 등 제3자 서비스 약관, 회사 내부 운영 정책을 위반하는
              자동화·발행 행위
            </li>
            <li>서비스 또는 Worker에 대한 역공학, 무단 접근, 과도한 API 호출, 악성 코드 유포</li>
            <li>서비스를 통해 취득한 정보를 회사 승인 없이 외부에 유출·공개하는 행위</li>
            <li>기타 서비스의 안정적 운영을 방해하거나 회사·제3자에게 손해를 주는 행위</li>
          </ol>
        </div>

        <div>
          <h4>제8조 (연동 서비스 준수)</h4>
          <p>
            관리자는 Google AdSense Management API, Anthropic, Supabase 등 연동 서비스의 이용 약관·API
            정책·할당량을 준수해야 하며, 위반으로 발생하는 제재·손해는 관리자 또는 해당 운영
            책임자에게 귀속될 수 있습니다.
          </p>
        </div>
      </div>

      <div>
        <h3>제4장 회사의 의무 및 책임 제한</h3>

        <div>
          <h4>제9조 (회사의 의무)</h4>
          <ol>
            <li>회사는 관련 법령과 본 약관이 정하는 바에 따라 서비스를 안정적으로 제공하기 위해
              노력합니다.
            </li>
            <li>회사는 관리자 정보 보호를 위해 접근 통제, 암호화, 로그 관리 등 합리적인 보안 조치를
              취합니다.
            </li>
            <li>회사는 개인정보처리방침에 따라 관리자 정보를 처리합니다.</li>
          </ol>
        </div>

        <div>
          <h4>제10조 (책임의 제한)</h4>
          <ol>
            <li>
              회사는 천재지변, 전력·통신 장애, Cloudflare·Vercel·Google·Supabase 등 제3자 서비스
              장애, 관리자의 귀책 사유로 인한 손해에 대해 책임을 지지 않습니다.
            </li>
            <li>
              AdSense 수치, 자동화 실행 결과, 플랫폼 노출·수익 등은 외부 서비스 정책·알고리즘에
              영향을 받으며, 회사는 특정 성과를 보장하지 않습니다.
            </li>
            <li>회사의 고의 또는 중과실로 인한 손해에 대해서는 관련 법령이 허용하는 범위 내에서
              책임을 집니다.
            </li>
          </ol>
        </div>
      </div>

      <div>
        <h3>제5장 계약 해지 및 기타</h3>

        <div>
          <h4>제11조 (이용 제한 및 해지)</h4>
          <ol>
            <li>회사는 관리자가 본 약관을 위반하거나 보안상 필요한 경우 계정 접근을 제한·해지할 수
              있습니다.
            </li>
            <li>관리자 퇴직·역할 변경 등으로 이용이 종료되는 경우 회사는 계정을 비활성화할 수
              있습니다.
            </li>
          </ol>
        </div>

        <div>
          <h4>제12조 (지적재산권)</h4>
          <p>
            서비스에 관한 소프트웨어, UI, 로고, 문서 등에 대한 권리는 회사 또는 정당한 권리자에게
            귀속됩니다. 관리자는 회사의 사전 서면 동의 없이 이를 복제·배포·상업적으로 이용할 수
            없습니다.
          </p>
        </div>

        <div>
          <h4>제13조 (준거법 및 관할)</h4>
          <p>
            본 약관은 대한민국 법령에 따르며, 서비스와 관련하여 분쟁이 발생한 경우 회사 본점
            소재지를 관할하는 법원을 제1심 관할 법원으로 합니다.
          </p>
        </div>

        <div>
          <h4>부칙</h4>
          <p>문의: cmunj2025@gmail.com · 운영사: 테크앤조이 · 서비스: HUMA Studio (romang-ai.com)</p>
        </div>
      </div>
    </div>
  );
}

export function PrivacyDocContent() {
  return (
    <div className="huma-legal-doc">
      <div>
        <p>
          테크앤조이(이하 &quot;회사&quot;)는 HUMA Studio(
          <a href="https://romang-ai.com">https://romang-ai.com</a>) 운영과 관련하여 「개인정보
          보호법」 등 관련 법령을 준수하며, 관리자 및 서비스 이용 과정에서 처리되는 개인정보를
          보호하기 위해 본 방침을 수립·공개합니다.
        </p>
        <p className="huma-legal-doc-footnote">시행일: 2026년 6월 1일</p>
      </div>

      <div>
        <h3>1. 수집하는 개인정보 항목 및 방법</h3>

        <div>
          <h4>가. 수집 항목</h4>
          <table>
            <thead>
              <tr>
                <th>구분</th>
                <th>수집 항목</th>
                <th>수집 목적</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>관리자 계정</td>
                <td>아이디(이메일), 비밀번호(암호화 저장), 이름, 워크스페이스 권한, 최종 로그인 시각</td>
                <td>관리자 인증, 접근 통제, 감사 로그</td>
              </tr>
              <tr>
                <td>서비스 이용</td>
                <td>IP 주소, 브라우저·OS 정보, 접속 일시, API 요청 로그, 작업·운영 로그</td>
                <td>보안, 장애 대응, 운영 이력 관리</td>
              </tr>
              <tr>
                <td>연동 API</td>
                <td>
                  Google AdSense OAuth 토큰(서버 보관), AdSense 수익·조회 통계(리포트 표시용),
                  Supabase에 저장된 계정·작업 메타데이터
                </td>
                <td>대시보드·리포트 제공, 자동화 작업 실행</td>
              </tr>
              <tr>
                <td>문의</td>
                <td>이메일, 문의 내용</td>
                <td>고객 지원, 장애·보안 대응</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div>
          <h4>나. 수집 방법</h4>
          <ul>
            <li>회사가 관리자 계정을 등록·부여할 때</li>
            <li>관리자가 로그인·서비스 이용·API 호출 시 자동 생성</li>
            <li>Google OAuth 등 연동 과정에서 관리자가 직접 승인할 때</li>
            <li>이메일 등을 통한 문의 시</li>
          </ul>
        </div>
      </div>

      <div>
        <h3>2. 개인정보의 이용 목적</h3>
        <ol>
          <li>HUMA Studio 관리자 인증 및 워크스페이스별 접근 권한 관리</li>
          <li>콘텐츠 발행·자동화 작업 큐 운영, Worker·모뎀·계정 연동 관리</li>
          <li>AdSense 등 연동 API를 통한 수익·운영 통계 표시</li>
          <li>서비스 보안, 부정 접근 방지, 장애·오류 분석</li>
          <li>법령상 의무 이행 및 분쟁 대응</li>
        </ol>
      </div>

      <div>
        <h3>3. 개인정보의 보유 및 이용 기간</h3>
        <p>원칙적으로 수집·이용 목적 달성 시 지체 없이 파기합니다. 다만 아래는 예외로 보관할 수
          있습니다.
        </p>
        <ul>
          <li>
            <strong>관리자 계정</strong>: 이용 종료(퇴직·권한 회수) 후 지체 없이 파기. 다만 보안
            감사를 위해 접속 로그는 최대 1년 보관할 수 있습니다.
          </li>
          <li>
            <strong>Google OAuth refresh token</strong>: i7 Worker 서버 환경변수에 보관하며, 연동
            해제·토큰 무효화 시 즉시 교체·삭제합니다.
          </li>
          <li>
            <strong>관련 법령</strong>: 전자상거래 등에서의 소비자보호에 관한 법률, 통신비밀보호법
            등에서 정한 기간이 있는 경우 해당 기간 보관
          </li>
        </ul>
      </div>

      <div>
        <h3>4. 개인정보의 제3자 제공 및 처리 위탁</h3>
        <p>회사는 원칙적으로 관리자 개인정보를 외부에 제공하지 않습니다. 다만 아래의 경우 예외가
          있습니다.
        </p>
        <ul>
          <li>관리자 사전 동의가 있는 경우</li>
          <li>법령에 근거하거나 수사·감독 기관의 적법한 요청이 있는 경우</li>
        </ul>
        <p>서비스 운영을 위해 다음과 같이 개인정보 처리가 위탁·이용될 수 있습니다.</p>
        <table>
          <thead>
            <tr>
              <th>수탁·이용 업체</th>
              <th>위탁·이용 업무</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel Inc.</td>
              <td>웹 대시보드 호스팅</td>
            </tr>
            <tr>
              <td>Cloudflare, Inc.</td>
              <td>API Tunnel, DNS, CDN</td>
            </tr>
            <tr>
              <td>Supabase, Inc.</td>
              <td>데이터베이스·인증 데이터 저장</td>
            </tr>
            <tr>
              <td>Google LLC</td>
              <td>AdSense Management API, OAuth 인증</td>
            </tr>
            <tr>
              <td>Anthropic PBC 등</td>
              <td>AI 콘텐츠 생성 API(해당 기능 사용 시)</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3>5. 개인정보의 파기 절차 및 방법</h3>
        <ul>
          <li>전자적 파일: 복구 불가능한 방법으로 영구 삭제</li>
          <li>출력물: 분쇄 또는 소각</li>
          <li>관리자 계정 삭제 시 JWT·세션·권한 정보를 함께 무효화</li>
        </ul>
      </div>

      <div>
        <h3>6. 관리자의 권리</h3>
        <p>
          관리자는 회사에 대해 본인의 개인정보 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 요청은
          cmunj2025@gmail.com 으로 접수하며, 회사는 관련 법령에 따라 지체 없이 조치합니다.
        </p>
      </div>

      <div>
        <h3>7. 개인정보의 안전성 확보 조치</h3>
        <ul>
          <li>관리자 비밀번호 bcrypt 등 일방향 암호화 저장</li>
          <li>JWT 기반 API 인증, 워크스페이스별 접근 통제</li>
          <li>HTTPS·Tunnel을 통한 전송 구간 보호</li>
          <li>운영 서버·환경변수(.env)에 API 키·OAuth 토큰 분리 보관</li>
          <li>접근 권한 최소화 및 운영 로그 기록</li>
        </ul>
      </div>

      <div>
        <h3>8. 쿠키 및 자동 수집</h3>
        <p>
          HUMA Studio는 관리자 로그인 유지(localStorage JWT 등) 및 보안을 위해 브라우저 저장소·세션
          정보를 사용할 수 있습니다. 브라우저 설정으로 저장을 거부할 경우 일부 기능 이용이
          제한될 수 있습니다.
        </p>
      </div>

      <div>
        <h3>9. Google AdSense API 관련 안내</h3>
        <p>
          퀴즈오아시스 워크스페이스의 AdSense 수익 메뉴는 Google AdSense Management API v2를
          사용합니다. OAuth refresh token은 i7 Worker의 서버 환경변수에만 저장되며, 브라우저에
          노출되지 않습니다. 표시되는 수치는 Google API 응답을 기반으로 하며, 회사는 Google
          계정의 원본 데이터를 별도로 영구 저장하지 않습니다(캐시·로그 제외).
        </p>
        <p>
          Google API Services User Data Policy을 준수하며, AdSense 데이터는 HUMA Studio 대시보드
          운영 목적으로만 사용합니다.
        </p>
      </div>

      <div>
        <h3>10. 개인정보 보호책임자</h3>
        <table>
          <thead>
            <tr>
              <th>구분</th>
              <th>내용</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>회사명</td>
              <td>테크앤조이</td>
            </tr>
            <tr>
              <td>서비스명</td>
              <td>HUMA Studio</td>
            </tr>
            <tr>
              <td>문의 이메일</td>
              <td>cmunj2025@gmail.com</td>
            </tr>
          </tbody>
        </table>
        <p>기타 개인정보 침해 신고·상담</p>
        <ul>
          <li>개인정보침해신고센터 (privacy.kisa.or.kr / 국번 없이 118)</li>
          <li>대검찰청 사이버수사과 (www.spo.go.kr / 국번 없이 1301)</li>
          <li>경찰청 사이버수사국 (ecrm.police.go.kr / 국번 없이 182)</li>
        </ul>
      </div>

      <div>
        <h3>11. 방침의 변경</h3>
        <p>
          본 방침이 변경되는 경우 변경 적용일 7일 전부터 서비스 공지 또는 본 페이지를 통해
          고지합니다. 중요한 변경은 별도로 관리자에게 통지할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
