import { useState } from 'react';
import type { GalleryList } from '../../../shared/gallery.ts';
import { t } from '../../../shared/i18n/index.ts';
import {
  AUTHOR_MAX,
  DEFAULT_LICENSE,
  LICENSE_LABEL,
  PET_LICENSES,
  type PetLicense,
} from '../../../shared/pet-share.ts';
import { PET_KINDS } from '../../../shared/settings.ts';
import { bridge } from './ui.tsx';
import './gallery.css';

const FAIL_TEXT = {
  offline: 'settings.gallery.offline',
  notFound: 'settings.gallery.notFound',
  bad: 'settings.gallery.bad',
} as const;

/**
 * 펫 갤러리 (P1 #11): 누르면 메인이 GitHub 의 gallery/index.json 을 받아 보여 준다 (설정 창을 열 때마다 받지 않는다).
 * 갤러리에는 레포 주인이 고른 공식 펫만 있다. 데려오기는 메인이 sha256 확인 뒤 .jjpet 가져오기와 같은 검사로 한다.
 * 사용자끼리는 아래 "펫 파일로 내보내기"로 .jjpet 을 직접 주고받는다 (갤러리에 올리는 길은 없다)
 */
export function Gallery({ onMsg }: { onMsg: (m: string, error?: boolean) => void }) {
  const [list, setList] = useState<GalleryList | 'loading'>();
  const [busy, setBusy] = useState('');
  const load = async () => {
    setList('loading');
    setList(await bridge.galleryList().catch((): GalleryList => ({ ok: false, reason: 'offline' })));
  };
  const adopt = async (id: string, asFriend: boolean) => {
    setBusy(id);
    try {
      const r = await bridge.galleryAdopt(id, asFriend);
      if (r.message) onMsg(r.message, !r.ok);
    } catch {
      onMsg(t('settings.gallery.downloadFailed'), true);
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <small>{t('settings.gallery.lead')}</small>
      {list === undefined && (
        <div className="action-row">
          <button type="button" className="ghost" onClick={load}>
            {t('settings.gallery.open')}
          </button>
        </div>
      )}
      {list === 'loading' && (
        <small className="below" role="status">
          {t('settings.gallery.loading')}
        </small>
      )}
      {list && list !== 'loading' && !list.ok && (
        <div className="gallery-note" role="status">
          <span>{t(FAIL_TEXT[list.reason])}</span>
          <button type="button" className="link" onClick={load}>
            {t('settings.gallery.retry')}
          </button>
        </div>
      )}
      {list && list !== 'loading' && list.ok && list.pets.length === 0 && (
        <small className="below">{t('settings.gallery.empty')}</small>
      )}
      {list && list !== 'loading' && list.ok && list.pets.length > 0 && (
        <ul className="gallery-grid">
          {list.pets.map((p) => (
            <li key={p.id} className="gallery-card">
              {p.thumb ? (
                <img src={p.thumb} alt={t('settings.gallery.thumbAlt', { name: p.name })} />
              ) : (
                <i aria-hidden="true" />
              )}
              <span className="pet-name">{p.name}</span>
              <small>{PET_KINDS.find((k) => k.id === p.species)?.label}</small>
              <small className="gallery-by">
                {t('settings.gallery.by', { author: p.author, license: LICENSE_LABEL[p.license] })}
              </small>
              <div className="gallery-actions">
                <button
                  type="button"
                  className="ghost small"
                  disabled={!!busy}
                  onClick={() => adopt(p.id, false)}
                >
                  {busy === p.id ? t('settings.gallery.busy') : t('settings.gallery.adopt')}
                </button>
                <button
                  type="button"
                  className="ghost small"
                  disabled={!!busy}
                  onClick={() => adopt(p.id, true)}
                >
                  {t('settings.gallery.friend')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <GalleryShare onMsg={onMsg} />
    </>
  );
}

/** 친구에게 보내기: 만든 사람(선택), 사용 허락을 적어 판 2 .jjpet 으로 저장한다. 갤러리에는 올라가지 않는다 */
function GalleryShare({ onMsg }: { onMsg: (m: string, error?: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [author, setAuthor] = useState('');
  const [license, setLicense] = useState<PetLicense>(DEFAULT_LICENSE);
  const [saving, setSaving] = useState(false);
  if (!open)
    return (
      <div className="action-row">
        <button type="button" className="link" onClick={() => setOpen(true)}>
          {t('settings.gallery.share')}
        </button>
      </div>
    );
  const share = async () => {
    setSaving(true);
    try {
      const r = await bridge.galleryShare({ author, license });
      if (r.message) onMsg(r.message, !r.ok);
    } catch {
      onMsg(t('settings.gallery.failed'), true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="gallery-share">
      <b>{t('settings.gallery.share')}</b>
      <small>{t('settings.gallery.shareLead')}</small>
      <label className="field">
        <span>{t('settings.gallery.author')}</span>
        <input value={author} maxLength={AUTHOR_MAX} onChange={(e) => setAuthor(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('settings.gallery.license')}</span>
        <select value={license} onChange={(e) => setLicense(e.target.value as PetLicense)}>
          {PET_LICENSES.map((l) => (
            <option key={l} value={l}>
              {LICENSE_LABEL[l]}
            </option>
          ))}
        </select>
        <small>{t('settings.gallery.licenseHint')}</small>
      </label>
      <div className="action-row">
        <button type="button" className="ghost" disabled={saving} onClick={share}>
          {t('settings.gallery.make')}
        </button>
      </div>
    </div>
  );
}
