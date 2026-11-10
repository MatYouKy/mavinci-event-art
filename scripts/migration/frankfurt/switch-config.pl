#!/usr/bin/env perl
# Zamiana STAREGO projektu Supabase na NOWY w plikach konfiguracyjnych (wywołuje 12-switch-config.sh, lokalnie i na serwerze).
# Adres <stary>.supabase.co → <nowy>.supabase.co; klucze JWT starego projektu rozpoznawane po zawartości (ref + role)
# → klucz anon / service_role nowego projektu. Wartości kluczy nigdy nie są wypisywane.
#   perl switch-config.pl check                     — sprawdza klucze nowego projektu (stdin: anon, service_role)
#   perl switch-config.pl apply|dry PLIK…           — zmienia / tylko liczy (stdin: anon, service_role)
#   perl switch-config.pl apply|dry|restore --find KATALOG
#   perl switch-config.pl restore PLIK…             — przywraca pliki z kopii <plik>.przed-frankfurtem
#   pm2 jlist | perl switch-config.pl pm2           — które procesy PM2 mają jeszcze stary projekt (nazwy zmiennych)
#   perl switch-config.pl pm2env JLIST.json PROCES  — linie export z nowymi wartościami zmiennych procesu, które mają
#                                                     stary projekt (stdin: anon, service_role); wynik tylko do pliku na serwerze
use strict;
use warnings;
use MIME::Base64 qw(decode_base64);
use JSON::PP qw(decode_json);
use File::Find qw(find);
use File::Copy qw(copy);

my $OLD = $ENV{OLD_REF} or die "Brak OLD_REF\n";
my $NEW = $ENV{NEW_REF} // '';
my $mode = shift(@ARGV) // die "Brak trybu\n";
my $BACKUP = '.przed-frankfurtem';
my $JWT = qr/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

sub claims {
  my @part = split /\./, shift;
  return undef unless @part == 3;
  (my $b = $part[1]) =~ tr{-_}{+/};
  $b .= '=' x ((4 - length($b) % 4) % 4);
  my $json = eval { decode_json(decode_base64($b)) };
  return ref($json) eq 'HASH' ? $json : undef;
}
sub old_jwt_role { my $c = claims(shift); return ($c && ($c->{ref} // '') eq $OLD) ? ($c->{role} // '?') : undef; }

sub has_old {
  my $v = shift;
  return 0 unless defined $v && !ref $v;
  return 1 if $v =~ /\Q$OLD\E/;
  for my $t ($v =~ /($JWT)/g) { return 1 if defined old_jwt_role($t); }
  return 0;
}
# Zmienne środowiska procesu PM2: pm2_env.env oraz zmienne wielkimi literami w pm2_env.
sub pm2_vars {
  my $p = shift;
  my $e = $p->{pm2_env} || {};
  my %v;
  for my $k (keys %$e) { $v{$k} = $e->{$k} if $k =~ /^[A-Z_][A-Z0-9_]*$/ && !ref $e->{$k}; }
  if (ref $e->{env} eq 'HASH') { for my $k (keys %{$e->{env}}) { $v{$k} = $e->{env}{$k} if !ref $e->{env}{$k}; } }
  return \%v;
}
sub read_list {
  my $raw = shift // '[]';
  my $list = eval { decode_json($raw) };
  return ref $list eq 'ARRAY' ? $list : [];
}

if ($mode eq 'pm2') {
  my $list = read_list(do { local $/; <STDIN> });
  for my $p (@$list) {
    my $v = pm2_vars($p);
    my @old = sort grep { has_old($v->{$_}) } keys %$v;
    printf "  %-30s %s\n", $p->{name} // '?', @old ? 'STARY projekt: ' . join(', ', @old) : 'ok';
  }
  exit 0;
}

my ($anon, $service) = ('', '');
if ($mode =~ /^(check|apply|dry|pm2env)$/) {
  $anon = <STDIN> // ''; $service = <STDIN> // '';
  s/[\r\n]+$// for $anon, $service;
}

if ($mode eq 'check') {
  my %key = (anon => $anon, service_role => $service);
  for my $role (qw(anon service_role)) {
    my $c = claims($key{$role});
    die "Klucz $role nie jest kluczem JWT (eyJ…). Nowy projekt → Project Settings → API Keys → Legacy API Keys → $role.\n" unless $c;
    die "Klucz $role jest z innego projektu (" . ($c->{ref} // '?') . "), potrzebny klucz projektu $NEW.\n" unless ($c->{ref} // '') eq $NEW;
    die "W polu $role wklejono klucz roli „" . ($c->{role} // '?') . "”.\n" unless ($c->{role} // '') eq $role;
  }
  print "Klucze nowego projektu ($NEW): anon i service_role — poprawne.\n";
  exit 0;
}

# Zamiana w tekście: adres (bez db.<stary> — inne hasło) i klucze JWT starego projektu po roli. Zwraca liczniki.
sub convert {
  my ($s) = @_;
  my ($url, $ka, $ks, $other) = (0, 0, 0, 0);
  $url = ($s =~ s/(?<!db\.)\b\Q$OLD\E(?=\.supabase\.co)/$NEW/g) || 0 if $NEW;
  $s =~ s{($JWT)}{
    my $t = $1;
    my $role = old_jwt_role($t);
    if (!defined $role) { $t }
    elsif ($role eq 'anon') { $ka++; $anon ne '' ? $anon : $t }
    elsif ($role eq 'service_role') { $ks++; $service ne '' ? $service : $t }
    else { $other++; $t }
  }ge;
  return ($s, $url, $ka, $ks, $other);
}

if ($mode eq 'pm2env') {
  my ($json_file, $name) = @ARGV;
  die "Brak klucza anon / service_role\n" if $anon eq '' || $service eq '' || $NEW eq '';
  open(my $jf, '<', $json_file) or die "Nie mogę odczytać $json_file\n";
  my $list = read_list(do { local $/; <$jf> });
  my ($p) = grep { ($_->{name} // '') eq $name } @$list;
  exit 0 unless $p;
  my $v = pm2_vars($p);
  for my $k (sort keys %$v) {
    next unless has_old($v->{$k});
    my ($new) = convert($v->{$k});
    next if has_old($new);   # np. adres bazy z hasłem — tego nie zgadujemy
    (my $q = $new) =~ s/'/'\\''/g;
    print "export $k='$q'\n";
  }
  exit 0;
}

die "Nieznany tryb: $mode\n" unless $mode =~ /^(apply|dry|restore)$/;

my @files;
if (@ARGV && $ARGV[0] eq '--find') {
  my $root = $ARGV[1] // die "Brak katalogu\n";
  find(sub {
    if (-d $_ && /^(node_modules|\.next|\.next-build|standalone|logs|\.git|\.cache|\.npm|\.yarn)$/) { $File::Find::prune = 1; return; }
    return unless -f $_;
    return if /\Q$BACKUP\E$|\.bak|\.tmp$|^\.env\.before-|\.example$|frankfurt-tmp/;
    push @files, $File::Find::name if /^\.env(\..+)?$|\.env$|^ecosystem.*\.(c?js|json)$/;
  }, $root);
  @files = sort @files;
} elsif (@ARGV && $ARGV[0] eq '--find-all') {
  # Wszystkie pliki tekstowe (kod, konfiguracja) do 2 MB — dla usług spoza repo, np. imap-sync-worker.
  my $root = $ARGV[1] // die "Brak katalogu\n";
  find(sub {
    if (-d $_ && /^(node_modules|\.next|\.next-build|standalone|logs|\.git|\.cache|\.npm|\.yarn|public|uploads|tmp)$/) { $File::Find::prune = 1; return; }
    return unless -f $_ && !-l $_;
    return if /\Q$BACKUP\E$|\.bak|\.tmp$|^\.env\.before-|frankfurt-tmp|\.(log|map|png|jpe?g|gif|webp|pdf|zip|gz|ico|woff2?|ttf|lock)$/i;
    my $size = -s _;
    return if $size > 2_000_000 || !-T $_;
    push @files, $File::Find::name;
  }, $root);
  @files = sort @files;
  $ENV{QUIET} = 1;
} else {
  @files = @ARGV;
}

my $changed = 0;
for my $f (@files) {
  next unless -f $f;
  if ($mode eq 'restore') {
    next unless -f "$f$BACKUP";
    my $perm = (stat $f)[2] & 07777;
    copy("$f$BACKUP", "$f.frankfurt-tmp-$$") or die "Nie mogę skopiować $f$BACKUP: $!\n";
    chmod($perm, "$f.frankfurt-tmp-$$");
    rename("$f.frankfurt-tmp-$$", $f) or die "Nie mogę przywrócić $f: $!\n";
    print "  przywrócono: $f\n";
    $changed++;
    next;
  }
  open(my $in, '<:raw', $f) or do { print "  $f: nie mogę odczytać ($!)\n"; next };
  my $orig = do { local $/; <$in> };
  close $in;
  my $s = $orig;
  my ($url, $ka, $ks, $other);
  ($s, $url, $ka, $ks, $other) = convert($s);
  # Co zostało ze starego projektu (np. adres bazy z hasłem) — tylko nazwy zmiennych, bez wartości.
  my %left;
  for my $line (split /\n/, $s) {
    my $hit = $line =~ /\Q$OLD\E/;
    if (!$hit) { for my $t ($line =~ /($JWT)/g) { $hit = 1 if defined old_jwt_role($t); } }
    next unless $hit;
    my ($name) = $line =~ /^\s*(?:export\s+)?["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[=:]/;
    $left{$name // '(linia bez nazwy)'} = 1;
  }
  my $sb = () = $s =~ /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g;
  my @info;
  push @info, "adres ×$url" if $url;
  push @info, "klucz anon ×$ka" if $ka;
  push @info, "klucz service_role ×$ks" if $ks;
  push @info, 'bez zmian' unless @info;
  push @info, 'ZOSTAŁ stary projekt: ' . join(', ', sort keys %left) if %left;
  push @info, "klucze sb_… ×$sb (nie wiadomo, z którego projektu — sprawdź ręcznie)" if $sb;
  print "  $f: ", join('; ', @info), "\n" unless $ENV{QUIET} && $info[0] eq 'bez zmian' && @info == 1;
  next if $s eq $orig || $mode eq 'dry';
  my $perm = (stat $f)[2] & 07777;
  unless (-e "$f$BACKUP") {
    copy($f, "$f$BACKUP") or die "Nie mogę zrobić kopii $f: $!\n";
    chmod(0600, "$f$BACKUP");
  }
  my $tmp = "$f.frankfurt-tmp-$$";
  open(my $out, '>:raw', $tmp) or die "Nie mogę zapisać $tmp: $!\n";
  print $out $s;
  close($out) or die "Nie mogę zapisać $tmp: $!\n";
  chmod($perm, $tmp);
  rename($tmp, $f) or die "Nie mogę podmienić $f: $!\n";
  $changed++;
}
print $mode eq 'restore' ? "  — przywrócono plików: $changed\n" : "  — zmieniono plików: $changed\n" unless $mode eq 'dry';
